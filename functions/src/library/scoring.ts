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
import { requiredSnippetQuestionCount } from './code-snippet';

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
  isTechDomainInterview: z.boolean().default(false),
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
  "topicOutcomes": [ { "topic": string, "status": "strong"|"weak" } ],
  "isTechDomainInterview": boolean
}
skillDeltas should be small integers typically in [-8, +8]. No markdown.

Strict Answer Evaluation & Scoring Mandates (CRITICAL):
- Strictly grade candidate answers based on FACTUAL TECHNICAL ACCURACY, DIRECT RELEVANCE to the question asked, DEPTH, and PROBLEM-SOLVING.
- DO NOT award scores merely for talking, politeness, length of response, or confident tone if the content is incorrect, off-topic, evasive, or repetitive.
- Off-topic / Irrelevant / Nonsense / Random responses: If the candidate answered with something unrelated to the technical question asked (e.g. talking about unrelated topics, random banter, gibberish, filler, or avoiding the question), that question is completely FAILED (0 points).
- Parroting / Echoing the question: If the candidate simply repeats or paraphrases the interviewer's question back instead of providing an actual solution, award 0 points.
- If the candidate provided off-topic, irrelevant, or non-answers to most or all questions:
  * technicalScore MUST BE 0-15 (strictly failing, never 70-100 or 5/5).
  * problemSolvingScore MUST BE 0-15 (strictly failing).
  * overallScore MUST BE 0-20.
  * codingScore (if applicable) MUST BE 0-15.
  * Under NO circumstances should an off-topic or non-responsive candidate receive a high rating.

Feedback Guidelines (mandatory):
- strengths: List 2–3 genuine, professional strengths observed during the session. If technical answers were weak or off-topic, focus on positive behavioral or communication attributes (e.g. "Maintained a professional, respectful tone throughout the interview", "Willingness to engage and respond to live prompts", "Clear voice delivery"). NEVER output condescending, generic or robotic one-liners like "Attended the interview session" or "Showed up".
- weaknesses: List 2–3 concise, constructive areas for improvement. Focus on specific technical concepts or interview techniques (e.g. "Direct answer alignment: Ensure responses directly address the technical question asked rather than speaking broadly or deflecting", "Conceptual depth: Strengthen foundational understanding of core role technologies"). Do NOT repeat the exact same point in different words, and avoid aggressive or repetitive phrasing.
- recommendations: Provide 2–3 actionable, encouraging, and concrete learning steps (e.g. practicing structured answer frameworks, reviewing specific documentation or code architectures, hands-on debugging exercises).

- Strict Score Anchors for technicalScore & problemSolvingScore:
  * 0–19: Off-topic answers, nonsense, repeated questions back, non-answers, or completely wrong technical claims.
  * 20–39: Severe technical misunderstandings, confused fundamentals, or superficial buzzwords without answering.
  * 40–59: Partially correct but shallow, vague, or missing key technical concepts.
  * 60–74: Competent basic understanding, mostly correct with minor omissions.
  * 75–89: Solid, relevant, accurate answers with clear technical reasoning and examples.
  * 90–100: Exceptional, authoritative, in-depth mastery and precise trade-offs. Reserve 90+ ONLY for truly expert responses.

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
  (struggled, vague, incorrect, off-topic, or avoided the question).
- Only include topics that were actually asked about — do not invent topics.
- Every topic where the candidate gave an irrelevant, off-topic, incorrect, or evasive answer MUST have status "weak".
- If the candidate failed all technical topics, ALL topicOutcomes MUST have status "weak".

skillDeltas rules (mandatory):
- If candidate performance was poor or answers were off-topic, skill deltas for technical and problemSolving MUST be negative (e.g. -5 to -8), NOT positive.

isTechDomainInterview rule (mandatory):
- Decide whether this interview is for a technology/software/IT/coding-engineering role, based on
  the config (currentRole, targetRole, technologies, skills, topic, company) and the transcript.
- Set true for software/technical roles; set false for non-technical domains (marketing, sales,
  civil/mechanical/other non-software engineering, pure HR/behavioral-only screens).

Code-snippet questions (only relevant when isTechDomainInterview is true):
- Turns in the transcript marked "[CODE SNIPPET - <language>]" are code-reading/debugging
  questions. Grade the candidate's ability to trace/explain/debug code specifically, and factor
  that into codingScore (include codingScore whenever isTechDomainInterview is true).
- sessionMeta.codeSnippetQuestionsAsked / codeSnippetQuestionsRequired tell you how many were
  actually asked vs required. If asked < required, factor that into codingScore and overallScore.`;

/** ~1 question per 3 minutes; clamp to a sensible interview range. */
export function expectedQuestionCount(durationMinutes: number): number {
  const minutes = Number.isFinite(durationMinutes) ? durationMinutes : 30;
  return Math.min(16, Math.max(4, Math.round(minutes / 3)));
}

function isMeaningfulTurn(text: string | undefined): boolean {
  return (text ?? '').trim().length >= 8;
}

/** Check if candidate text is a generic refusal, evasion, or filler rather than an answer. */
export function isNonAnswerOrFiller(text: string | undefined): boolean {
  if (!text) return true;
  const t = text.trim().toLowerCase().replace(/[.,!?;:]+$/, '');
  return (
    /^(i (don'?t|do not) know( anything)?|no idea|no clue|skip|pass|repeat the question|can you repeat|i am not sure|not sure|next question|nothing|no answer|idk|n\/a)$/i.test(t)
  );
}

/** Check if candidate text simply parrots or echoes the assistant's previous question. */
export function isParrotingQuestion(candidateText: string | undefined, assistantText: string | undefined): boolean {
  if (!candidateText || !assistantText) return false;
  const c = candidateText.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const a = assistantText.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!c || !a) return false;
  if (c === a) return true;
  if (c.length >= 15 && (a.includes(c) || c.includes(a))) return true;
  return false;
}

/** Count non-trivial candidate answer turns from persisted conversation. */
export function countCandidateAnswers(
  conversation: InterviewConversationMessage[] | undefined,
): number {
  if (!conversation?.length) return 0;
  let count = 0;
  let lastAssistantText = '';
  for (const m of conversation) {
    if (m.role === 'assistant') {
      lastAssistantText = m.text;
    } else if (m.role === 'candidate') {
      if (
        isMeaningfulTurn(m.text) &&
        !isNonAnswerOrFiller(m.text) &&
        !isParrotingQuestion(m.text, lastAssistantText)
      ) {
        count += 1;
      }
    }
  }
  return count;
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
  let lastInterviewerText = '';
  for (const line of lines) {
    if (/^\s*(Interviewer|AI|System)\s*:/i.test(line)) {
      lastInterviewerText = line.replace(/^\s*(Interviewer|AI|System)\s*:/i, '');
    } else if (/^\s*(Candidate|User|Applicant)\s*:/i.test(line)) {
      const body = line.replace(/^\s*(Candidate|User|Applicant)\s*:/i, '');
      if (
        isMeaningfulTurn(body) &&
        !isNonAnswerOrFiller(body) &&
        !isParrotingQuestion(body, lastInterviewerText)
      ) {
        count += 1;
      }
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

/** Scale factor applied to codingScore/overallScore when required snippet questions were skipped. */
export function snippetCoverageMultiplier(asked: number, required: number): number {
  if (required <= 0) return 1;
  const ratio = Math.min(1, Math.max(0, asked / required));
  return 0.6 + 0.4 * ratio;
}

/**
 * Second, independent deterministic pass (runs after applyCoverageAdjustment): penalizes
 * tech-domain interviews that skipped the required minimum of code-snippet questions
 * (see CODE SNIPPET QUESTIONS in interview-prompt.ts). No-ops for non-tech-domain interviews
 * or when the requirement was met.
 */
export function applySnippetCoverageAdjustment(
  scores: ScoreInterviewResult,
  params: {
    codeSnippetQuestionsAsked: number;
    codeSnippetQuestionsRequired: number;
  },
): ScoreInterviewResult {
  if (!scores.isTechDomainInterview) return scores;

  const { codeSnippetQuestionsAsked: asked, codeSnippetQuestionsRequired: required } = params;
  if (required <= 0 || asked >= required) return scores;

  const multiplier = snippetCoverageMultiplier(asked, required);
  const baseCoding = scores.codingScore ?? Math.round(scores.technicalScore * 0.8);
  const adjustedCoding = clampScore(baseCoding * multiplier);
  const overallMultiplier = 0.85 + 0.15 * (asked / required);
  const adjustedOverall = clampScore(scores.overallScore * overallMultiplier);

  const note = `Incomplete code-snippet coverage: asked ${asked} of ${required} required code-snippet question${required === 1 ? '' : 's'}.`;
  // Filter out any duplicate / generic snippet notes previously emitted by LLM
  const remainingWeaknesses = (scores.weaknesses ?? []).filter(
    (w) => !/code-?snippet|snippet question/i.test(w),
  );

  return {
    ...scores,
    overallScore: adjustedOverall,
    codingScore: adjustedCoding,
    weaknesses: [note, ...remainingWeaknesses].slice(0, 6),
  };
}

/**
 * Third deterministic pass: ties technicalScore, problemSolvingScore, and codingScore
 * directly to the candidate's actual topic outcomes and penalizes off-topic/non-answers.
 * Prevents LLM hallucination from awarding 100 or passing scores when answers were off-topic or weak.
 */
export function applyStrictAccuracyAdjustment(
  scores: ScoreInterviewResult,
): ScoreInterviewResult {
  const topics = scores.topicOutcomes ?? [];
  if (!topics.length) {
    return scores;
  }

  const strongCount = topics.filter((t) => t.status === 'strong').length;
  const totalTopics = topics.length;
  const strongRatio = strongCount / totalTopics;

  // Case 1: Candidate failed all evaluated topics (0 strong answers).
  // Irrelevant, off-topic, or non-answers must never yield passing or high scores.
  if (strongCount === 0) {
    const cappedTech = Math.min(scores.technicalScore, 10);
    const cappedProblem = Math.min(scores.problemSolvingScore, 10);
    const cappedOverall = Math.min(scores.overallScore, 15);
    const cappedCoding =
      scores.codingScore !== undefined
        ? Math.min(scores.codingScore, 10)
        : undefined;

    const weakness = 'Direct answer alignment: Ensure responses directly address the technical questions rather than deflecting or speaking off-topic.';
    const alreadyNoted = scores.weaknesses.some((w) =>
      /off-topic|irrelevant|non-answers|struggled across|direct answer alignment/i.test(w),
    );

    return {
      ...scores,
      overallScore: cappedOverall,
      technicalScore: cappedTech,
      problemSolvingScore: cappedProblem,
      ...(cappedCoding !== undefined ? { codingScore: cappedCoding } : {}),
      skillDeltas: {
        ...scores.skillDeltas,
        technical: Math.min(scores.skillDeltas.technical ?? 0, -6),
        problemSolving: Math.min(scores.skillDeltas.problemSolving ?? 0, -6),
      },
      weaknesses: alreadyNoted ? scores.weaknesses : [weakness, ...scores.weaknesses].slice(0, 6),
    };
  }

  // Case 2: Candidate had mixed performance.
  // Cap technicalScore and problemSolvingScore so they cannot wildly exceed demonstrated topic mastery.
  const maxAllowedTech = Math.round(15 + strongRatio * 85);
  const cappedTech = Math.min(scores.technicalScore, maxAllowedTech);
  const cappedProblem = Math.min(scores.problemSolvingScore, Math.min(100, maxAllowedTech + 10));
  const maxAllowedOverall = Math.min(100, Math.round(maxAllowedTech * 1.15));
  const cappedOverall = Math.min(scores.overallScore, maxAllowedOverall);

  return {
    ...scores,
    overallScore: cappedOverall,
    technicalScore: cappedTech,
    problemSolvingScore: cappedProblem,
  };
}

const DISALLOWED_STRENGTH_PATTERNS = [
  /attended (the )?interview/i,
  /showed up/i,
  /basic (interview )?presence/i,
  /basic participation/i,
  /logged in/i,
  /completed the session/i,
];

/** Remove condescending/robotic one-liners and guarantee constructive professional strengths. */
export function cleanStrengths(strengths: string[] | undefined): string[] {
  const filtered = (strengths ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !DISALLOWED_STRENGTH_PATTERNS.some((p) => p.test(s)));

  if (filtered.length >= 2) {
    return Array.from(new Set(filtered)).slice(0, 3);
  }

  const constructiveDefaults = [
    'Maintained a professional, respectful communication tone throughout the dialogue',
    'Demonstrated active engagement and willingness to participate in live technical questioning',
  ];

  return Array.from(new Set([...filtered, ...constructiveDefaults])).slice(0, 3);
}

/** Deduplicate overlapping coverage and off-topic notes into clean, distinct constructive points. */
export function cleanWeaknesses(weaknesses: string[] | undefined): string[] {
  const result: string[] = [];
  let hasSnippetNote = false;
  let hasCoverageNote = false;
  let hasOffTopicNote = false;

  for (const w of weaknesses ?? []) {
    const text = w.trim();
    if (!text) continue;

    // Code snippet notes: keep at most one detailed metric note
    if (/code-?snippet|snippet question/i.test(text)) {
      if (!hasSnippetNote) {
        result.push(text);
        hasSnippetNote = true;
      }
      continue;
    }

    // Session coverage notes: keep at most one
    if (/incomplete coverage|few questions|ended early|early exit/i.test(text)) {
      if (!hasCoverageNote) {
        result.push(text);
        hasCoverageNote = true;
      }
      continue;
    }

    // Off-topic / irrelevance / parroting notes: keep at most one consolidated point
    if (/off-topic|irrelevant|parroted|echoed|non-answers|direct answer alignment/i.test(text)) {
      if (!hasOffTopicNote) {
        result.push(text);
        hasOffTopicNote = true;
      }
      continue;
    }

    // Domain / conceptual technical weaknesses: avoid exact duplicates
    if (!result.some((existing) => existing.toLowerCase() === text.toLowerCase())) {
      result.push(text);
    }
  }

  return result.slice(0, 4);
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
  codeSnippetQuestionsAsked?: number;
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

  const codeSnippetQuestionsAsked = Math.max(0, params.codeSnippetQuestionsAsked ?? 0);
  const codeSnippetQuestionsRequired = requiredSnippetQuestionCount(params.durationMinutes);

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
      codeSnippetQuestionsAsked,
      codeSnippetQuestionsRequired,
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

  const coverageAdjusted = applyCoverageAdjustment(parsed.data, {
    durationSec: params.durationSec,
    durationMinutes: params.durationMinutes,
    endReason: params.endReason,
    questionsAnswered,
    questionsAsked,
  });

  const accuracyAdjusted = applyStrictAccuracyAdjustment(coverageAdjusted);

  const snippetAdjusted = applySnippetCoverageAdjustment(accuracyAdjusted, {
    codeSnippetQuestionsAsked,
    codeSnippetQuestionsRequired,
  });

  const finalized: ScoreInterviewResult = {
    ...snippetAdjusted,
    strengths: cleanStrengths(snippetAdjusted.strengths),
    weaknesses: cleanWeaknesses(snippetAdjusted.weaknesses),
  };

  return omitUndefinedScoreFields(finalized);
}

/**
 * Validate a candidate scoring object without calling Gemini (for tests / fallbacks).
 */
export function validateScoreShape(value: unknown): ScoreInterviewResult {
  return scoreInterviewSchema.parse(value);
}
