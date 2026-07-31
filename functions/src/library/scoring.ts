/**
 * Interview scoring via Gemini text model with runtime shape validation.
 * Coverage-aware: early exits / few answers cannot inflate overall score.
 */

import { z } from 'zod';
import type {
  EndReason,
  InterviewConfig,
  InterviewConversationMessage,
  InterviewResults,
} from '../interfaces/interview.interface';
import { generateJson } from './gemini-client';

const scoreInterviewSchema = z.object({
  overallScore: z.number().min(0).max(100),
  technicalScore: z.number().min(0).max(100),
  communicationScore: z.number().min(0).max(100),
  confidenceScore: z.number().min(0).max(100),
  problemSolvingScore: z.number().min(0).max(100),
  codingScore: z.number().min(0).max(100).optional(),
  behaviorScore: z.number().min(0).max(100).optional(),
  skillDeltas: z.record(z.string(), z.number()),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  recommendations: z.array(z.string()),
  nextLearningPathId: z.string().optional(),
  topicOutcomes: z
    .array(
      z.object({
        topic: z.string(),
        status: z.enum(['strong', 'weak']),
      }),
    )
    .default([]),
});

export type ScoreInterviewResult = z.infer<typeof scoreInterviewSchema>;

const SCORING_SYSTEM_PROMPT = `You are an expert interview evaluator.
Respond ONLY with valid JSON matching this shape:
{
  "overallScore": number 0-100,
  "technicalScore": number 0-100,
  "communicationScore": number 0-100,
  "confidenceScore": number 0-100,
  "problemSolvingScore": number 0-100,
  "codingScore": number 0-100 (optional),
  "behaviorScore": number 0-100 (optional),
  "skillDeltas": { "technical": number, "communication": number, "confidence": number, "problemSolving": number, "coding": number, "behavior": number },
  "strengths": string[],
  "weaknesses": string[],
  "recommendations": string[],
  "topicOutcomes": [ { "topic": string, "status": "strong"|"weak" } ]
}
skillDeltas should be small integers typically in [-8, +8]. No markdown.

Coverage rules (mandatory):
- Score against the FULL planned session (durationMinutes), not only answered turns.
- Few strong answers in a short time must NOT produce a high overallScore.
- Early user exit with substantial time remaining must lower overallScore and list incomplete coverage as a weakness.
- Unasked / unanswered topics count as incomplete coverage.
- High scores require both answer quality AND breadth across the planned interview.

topicOutcomes rules (mandatory):
- List 3-8 concise, specific concept/topic names actually discussed in the transcript
  (e.g. "useEffect cleanup", "closures", "REST API design", "SQL joins" — not vague labels like "JavaScript" alone).
- Classify each as "strong" (candidate answered confidently and correctly) or "weak"
  (struggled, vague, incorrect, or avoided the question).
- Only include topics that were actually asked about — do not invent topics.`;

/** ~1 question per 3 minutes; clamp to a sensible interview range. */
export function expectedQuestionCount(durationMinutes: number): number {
  const minutes = Number.isFinite(durationMinutes) ? durationMinutes : 30;
  return Math.min(16, Math.max(4, Math.round(minutes / 3)));
}

function isMeaningfulTurn(text: string | undefined): boolean {
  return (text ?? '').trim().length >= 8;
}

/** Count non-trivial candidate answer turns from persisted conversation. */
export function countCandidateAnswers(
  conversation: InterviewConversationMessage[] | undefined,
): number {
  if (!conversation?.length) return 0;
  return conversation.filter(
    (m) => m.role === 'candidate' && isMeaningfulTurn(m.text),
  ).length;
}

/** Count interviewer turns (proxy for questions asked). */
export function countAssistantQuestions(
  conversation: InterviewConversationMessage[] | undefined,
): number {
  if (!conversation?.length) return 0;
  return conversation.filter(
    (m) => m.role === 'assistant' && isMeaningfulTurn(m.text),
  ).length;
}

/**
 * Fallback when conversation array is empty but transcript text exists
 * (e.g. client-only summary with "Candidate:" / "Interviewer:" lines).
 */
export function countCandidateAnswersFromTranscript(transcript: string): number {
  if (!transcript?.trim()) return 0;
  const lines = transcript.split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    if (/^\s*(Candidate|User|Applicant)\s*:/i.test(line)) {
      const body = line.replace(/^\s*(Candidate|User|Applicant)\s*:/i, '');
      if (isMeaningfulTurn(body)) count += 1;
    }
  }
  return count;
}

export interface CoverageMetrics {
  expectedQuestions: number;
  questionsAnswered: number;
  questionsAsked: number;
  /** answered / expected, clamped 0–1 */
  coverageRatio: number;
  /** actual duration / planned duration, clamped 0–1 */
  timeRatio: number;
}

export function computeCoverageMetrics(params: {
  durationSec: number;
  durationMinutes: number;
  questionsAnswered: number;
  questionsAsked?: number;
}): CoverageMetrics {
  const expectedQuestions = expectedQuestionCount(params.durationMinutes);
  const questionsAnswered = Math.max(0, params.questionsAnswered);
  const questionsAsked = Math.max(
    0,
    params.questionsAsked ?? questionsAnswered,
  );
  const plannedSec = Math.max(1, params.durationMinutes * 60);
  const timeRatio = Math.min(
    1,
    Math.max(0, params.durationSec / plannedSec),
  );
  const coverageRatio = Math.min(1, questionsAnswered / expectedQuestions);
  return {
    expectedQuestions,
    questionsAnswered,
    questionsAsked,
    coverageRatio,
    timeRatio,
  };
}

/**
 * Map coverage ratio → score multiplier.
 * >=80% full credit; sparse sessions scale down hard.
 */
export function coverageMultiplier(coverageRatio: number): number {
  const c = Math.min(1, Math.max(0, coverageRatio));
  if (c >= 0.8) return 1;
  if (c >= 0.5) return 0.7 + ((c - 0.5) / 0.3) * 0.3; // 0.7 → 1.0
  if (c >= 0.25) return 0.4 + ((c - 0.25) / 0.25) * 0.3; // 0.4 → 0.7
  return Math.max(0.25, c); // very sparse
}

function clampScore(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

function scaleScoreField(
  value: number | undefined,
  multiplier: number,
  cap: number,
): number | undefined {
  if (value === undefined) return undefined;
  return Math.min(cap, clampScore(value * multiplier));
}

/**
 * Deterministic post-process so Gemini alone cannot award high scores
 * for 2 good answers in a 30-min session.
 */
export function applyCoverageAdjustment(
  scores: ScoreInterviewResult,
  params: {
    durationSec: number;
    durationMinutes: number;
    endReason: EndReason;
    questionsAnswered: number;
    questionsAsked?: number;
  },
): ScoreInterviewResult {
  const metrics = computeCoverageMetrics(params);
  let multiplier = coverageMultiplier(metrics.coverageRatio);
  let hardCap = 100;

  // Early voluntary exit with lots of time left → strong cap.
  if (params.endReason === 'user_ended' && metrics.timeRatio < 0.5) {
    multiplier = Math.min(multiplier, Math.max(0.25, metrics.coverageRatio));
    hardCap = 50;
  }

  // connection_lost: still apply coverage (incomplete evidence) but no quit-style cap.
  // time_expired / max_questions_signal: coverage multiplier only.

  if (multiplier >= 0.999 && hardCap >= 100) {
    return omitUndefinedScoreFields(scores);
  }

  const scale = (value: number): number =>
    Math.min(hardCap, clampScore(value * multiplier));

  // Omit optional scores when absent — Firestore rejects explicit `undefined`.
  const { codingScore: _c, behaviorScore: _b, ...required } = scores;
  const adjusted: ScoreInterviewResult = {
    ...required,
    overallScore: scale(scores.overallScore),
    technicalScore: scale(scores.technicalScore),
    communicationScore: scale(scores.communicationScore),
    confidenceScore: scale(scores.confidenceScore),
    problemSolvingScore: scale(scores.problemSolvingScore),
    ...(scores.codingScore !== undefined
      ? {
          codingScore: scaleScoreField(
            scores.codingScore,
            multiplier,
            hardCap,
          ),
        }
      : {}),
    ...(scores.behaviorScore !== undefined
      ? {
          behaviorScore: scaleScoreField(
            scores.behaviorScore,
            multiplier,
            hardCap,
          ),
        }
      : {}),
  };

  const coverageNote = `Incomplete coverage: answered ${metrics.questionsAnswered} of ~${metrics.expectedQuestions} expected questions for a ${params.durationMinutes}-minute interview.`;
  const alreadyNoted = adjusted.weaknesses.some((w) =>
    /incomplete coverage|few questions|ended early|early exit/i.test(w),
  );
  if (metrics.coverageRatio < 0.8 && !alreadyNoted) {
    adjusted.weaknesses = [coverageNote, ...adjusted.weaknesses].slice(0, 6);
  }

  return omitUndefinedScoreFields(adjusted);
}

/** Drop keys whose value is `undefined` so Firestore writes do not fail. */
function omitUndefinedScoreFields(
  scores: ScoreInterviewResult,
): ScoreInterviewResult {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(scores)) {
    if (value !== undefined) cleaned[key] = value;
  }
  return cleaned as ScoreInterviewResult;
}

/**
 * Score an interview from a transcript summary + config. Validates LLM JSON,
 * then applies deterministic coverage adjustment.
 */
export async function scoreInterview(params: {
  transcriptSummary: string;
  config: InterviewConfig;
  mode: string;
  durationSec: number;
  durationMinutes: number;
  endReason: EndReason;
  conversation?: InterviewConversationMessage[];
}): Promise<InterviewResults> {
  const fromConversation = countCandidateAnswers(params.conversation);
  const questionsAnswered =
    fromConversation > 0
      ? fromConversation
      : countCandidateAnswersFromTranscript(params.transcriptSummary);
  const questionsAsked = countAssistantQuestions(params.conversation);

  const coverage = computeCoverageMetrics({
    durationSec: params.durationSec,
    durationMinutes: params.durationMinutes,
    questionsAnswered,
    questionsAsked,
  });

  const userPrompt = JSON.stringify({
    mode: params.mode,
    config: params.config,
    transcriptSummary: params.transcriptSummary,
    sessionMeta: {
      durationSec: params.durationSec,
      durationMinutes: params.durationMinutes,
      endReason: params.endReason,
      expectedQuestions: coverage.expectedQuestions,
      questionsAnswered: coverage.questionsAnswered,
      questionsAsked: coverage.questionsAsked,
      coverageRatio: Number(coverage.coverageRatio.toFixed(2)),
      timeRatio: Number(coverage.timeRatio.toFixed(2)),
    },
  });

  const raw = await generateJson<unknown>({
    systemInstruction: SCORING_SYSTEM_PROMPT,
    userPrompt,
  });

  const parsed = scoreInterviewSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid scoring response from Gemini: ${parsed.error.message}`,
    );
  }

  return omitUndefinedScoreFields(
    applyCoverageAdjustment(parsed.data, {
      durationSec: params.durationSec,
      durationMinutes: params.durationMinutes,
      endReason: params.endReason,
      questionsAnswered,
      questionsAsked,
    }),
  );
}

/**
 * Validate a candidate scoring object without calling Gemini (for tests / fallbacks).
 */
export function validateScoreShape(value: unknown): ScoreInterviewResult {
  return scoreInterviewSchema.parse(value);
}
