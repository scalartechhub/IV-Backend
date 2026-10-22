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

const scoreNumber = z.coerce.number().min(0).max(100);

const scoreInterviewSchema = z.object({
  overallScore: scoreNumber,
  technicalScore: scoreNumber,
  communicationScore: scoreNumber,
  confidenceScore: scoreNumber,
  problemSolvingScore: scoreNumber,
  codingScore: scoreNumber.optional(),
  behaviorScore: scoreNumber.optional(),
  skillDeltas: z.record(z.string(), z.coerce.number()).default({}),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
  nextLearningPathId: z.string().optional(),
  topicOutcomes: z
    .array(
      z.object({
        topic: z.string(),
        status: z
          .string()
          .transform((value) => (value.toLowerCase() === 'strong' ? 'strong' : 'weak')),
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

Feedback Guidelines (mandatory — candidate-facing only):
- Grade ONLY questions the interviewer actually asked. Never penalize the candidate for topics, formats, or code-snippet questions that were never asked.
- Never mention interviewer process (e.g. "0 of 2 required code-snippet questions", "snippet coverage", "unasked topics", "incomplete question quota") in strengths, weaknesses, or recommendations.
- strengths: 2–3 specific things the candidate did well, grounded in the transcript (named topics, examples they gave, communication). No robotic lines like "Attended the interview" or "Showed up".
- weaknesses: 2–3 topic-level improvement areas from questions they WERE asked (e.g. "HTTP interceptors: explain the request/response pipeline with a concrete example"). Name the topic. Do not write interviewer scorekeeping.
- recommendations: 2–3 concrete practice steps for those weak topics (docs, a small exercise, how to structure the next answer).
- overallScore must reflect a blend of technical accuracy, problem solving, communication, confidence, and behavior — not a single harsh cap when they showed any real knowledge.

- Strict Score Anchors for technicalScore & problemSolvingScore:
  * 0–19: Off-topic answers, nonsense, repeated questions back, non-answers, or completely wrong technical claims.
  * 20–39: Severe technical misunderstandings, confused fundamentals, or superficial buzzwords without answering.
  * 40–59: Partially correct but shallow, vague, or missing key technical concepts.
  * 60–74: Competent basic understanding, mostly correct with minor omissions.
  * 75–89: Solid, relevant, accurate answers with clear technical reasoning and examples.
  * 90–100: Exceptional, authoritative, in-depth mastery and precise trade-offs. Reserve 90+ ONLY for truly expert responses.

Coverage rules (mandatory):
- Score the candidate against questions they were asked and answered, not against a planned quota of unasked questions.
- If they answered the questions that were asked, do not lower scores because the interviewer asked fewer questions than durationMinutes might allow.
- Early user exit (they asked to stop / skip remaining time) may lower overallScore; that is about their engagement, not missing interviewer questions.

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

Code-snippet questions (only when a snippet actually appeared in the transcript):
- Turns marked "[CODE SNIPPET - <language>]" are code-reading questions. Grade those answers into codingScore.
- If NO code snippet was shown in the transcript, do not mention snippets, do not invent a coding-coverage weakness, and do not reduce scores for "missing" snippet questions. sessionMeta snippet counts are interviewer stats, not candidate faults.`;

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

/** Used when Gemini scoring fails so interview completion can still persist a report. */
export function fallbackInterviewScore(questionsAnswered: number): ScoreInterviewResult {
  const engaged = questionsAnswered > 0;
  const overall = engaged ? 42 : 18;
  return {
    overallScore: overall,
    technicalScore: engaged ? 38 : 15,
    communicationScore: engaged ? 55 : 30,
    confidenceScore: engaged ? 50 : 28,
    problemSolvingScore: engaged ? 36 : 15,
    skillDeltas: {
      technical: engaged ? -2 : -5,
      communication: 0,
      confidence: 0,
      problemSolving: engaged ? -2 : -5,
    },
    strengths: engaged
      ? [
          'Stayed engaged and submitted answers during the live session',
          'Communicated responses in a professional spoken format',
        ]
      : [
          'Maintained a professional, respectful communication tone throughout the dialogue',
          'Demonstrated active engagement and willingness to participate in live technical questioning',
        ],
    weaknesses: engaged
      ? [
          'Technical depth: expand answers with concrete examples and trade-offs on the topics that were asked.',
        ]
      : ['Interview engagement: few scored answers were captured for this session.'],
    recommendations: [
      'Revisit the topics from this session and practice answering out loud with a specific example in each response.',
    ],
    topicOutcomes: [],
    isTechDomainInterview: false,
  };
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
  const asked = Math.max(0, params.questionsAsked ?? metrics.questionsAsked);
  const answeredWhatWasAsked =
    asked > 0 ? Math.min(1, metrics.questionsAnswered / asked) : 1;
  // Candidate coverage = answers to questions they were given, not interviewer quota.
  let multiplier = coverageMultiplier(answeredWhatWasAsked);
  let hardCap = 100;

  // Early voluntary exit with lots of time left → engagement cap.
  if (params.endReason === 'user_ended' && metrics.timeRatio < 0.5) {
    multiplier = Math.min(multiplier, Math.max(0.35, metrics.timeRatio + 0.15));
    hardCap = 70;
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

  const leftEarly = params.endReason === 'user_ended' && metrics.timeRatio < 0.5;
  const skippedAsked =
    asked > 0 && metrics.questionsAnswered / asked < 0.8;
  const alreadyNoted = adjusted.weaknesses.some((w) =>
    /ended early|early exit|did not answer|skipped asked/i.test(w),
  );
  if (leftEarly && !alreadyNoted) {
    adjusted.weaknesses = [
      'Interview engagement: the session ended before the planned time — work through remaining questions rather than wrapping up early.',
      ...adjusted.weaknesses,
    ].slice(0, 6);
  } else if (skippedAsked && !alreadyNoted) {
    adjusted.weaknesses = [
      `Interview engagement: answered ${metrics.questionsAnswered} of ${asked} questions that were asked.`,
      ...adjusted.weaknesses,
    ].slice(0, 6);
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
 * Snippet quotas are interviewer process, not candidate performance.
 * Keep this helper as a no-op so reports never blame the candidate for unasked snippets.
 */
export function applySnippetCoverageAdjustment(
  scores: ScoreInterviewResult,
  _params?: {
    codeSnippetQuestionsAsked: number;
    codeSnippetQuestionsRequired: number;
  },
): ScoreInterviewResult {
  return scores;
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

  // Case 1: No topic was classified strong. Cap technical depth, but keep
  // communication/confidence/behavior in the overall blend so a struggling
  // but engaged candidate is not scored as 10–15% overall.
  if (strongCount === 0) {
    const cappedTech = Math.min(scores.technicalScore, 35);
    const cappedProblem = Math.min(scores.problemSolvingScore, 35);
    const cappedCoding =
      scores.codingScore !== undefined
        ? Math.min(scores.codingScore, 35)
        : undefined;
    const communication = scores.communicationScore;
    const confidence = scores.confidenceScore;
    const behavior = scores.behaviorScore ?? communication;
    const blended = clampScore(
      cappedTech * 0.28 +
        cappedProblem * 0.22 +
        communication * 0.2 +
        confidence * 0.15 +
        behavior * 0.15,
    );
    const cappedOverall = Math.min(scores.overallScore, Math.min(45, blended));

    return {
      ...scores,
      overallScore: cappedOverall,
      technicalScore: cappedTech,
      problemSolvingScore: cappedProblem,
      ...(cappedCoding !== undefined ? { codingScore: cappedCoding } : {}),
      skillDeltas: {
        ...scores.skillDeltas,
        technical: Math.min(scores.skillDeltas.technical ?? 0, -4),
        problemSolving: Math.min(scores.skillDeltas.problemSolving ?? 0, -4),
      },
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
  let hasCoverageNote = false;
  let hasOffTopicNote = false;

  for (const w of weaknesses ?? []) {
    const text = w.trim();
    if (!text) continue;

    // Interviewer process / snippet quota is not candidate feedback.
    if (/code-?snippet|snippet question|asked \d+ of \d+ required/i.test(text)) {
      continue;
    }

    // Planned-quota coverage notes (unasked questions) are not candidate feedback.
    if (/incomplete coverage|few questions|expected questions for a \d+-minute/i.test(text)) {
      continue;
    }

    if (/ended early|early exit|wrap(ping)? up early/i.test(text)) {
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

export function cleanRecommendations(recommendations: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (recommendations ?? [])
        .map((item) => item.trim())
        .filter(
          (item) =>
            item.length > 0 && !/code-?snippet|snippet question|asked \d+ of \d+ required/i.test(item),
        ),
    ),
  ).slice(0, 3);
}

/** Prefer named topics the candidate actually struggled with over process notes. */
export function finalizeCandidateWeaknesses(scores: ScoreInterviewResult): string[] {
  const fromLlm = cleanWeaknesses(scores.weaknesses);
  const topicNotes = (scores.topicOutcomes ?? [])
    .filter((item) => item.status === 'weak' && item.topic.trim())
    .map(
      (item) =>
        `Strengthen ${item.topic.trim()}: answers on this topic were incomplete, vague, or incorrect.`,
    );

  const merged: string[] = [];
  for (const note of topicNotes) {
    const topic = note.replace(/^Strengthen /i, '').split(':')[0].trim().toLowerCase();
    if (fromLlm.some((item) => item.toLowerCase().includes(topic))) continue;
    merged.push(note);
  }
  for (const item of fromLlm) {
    if (!merged.some((existing) => existing.toLowerCase() === item.toLowerCase())) {
      merged.push(item);
    }
  }
  return merged.slice(0, 4);
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

  let parsedData: ScoreInterviewResult | null = null;
  try {
    const raw = await generateJson<unknown>({
      systemInstruction: SCORING_SYSTEM_PROMPT,
      userPrompt,
    });
    const parsed = scoreInterviewSchema.safeParse(raw);
    if (parsed.success) {
      parsedData = parsed.data;
    } else {
      console.error(
        '[scoreInterview] Invalid scoring JSON from Gemini',
        parsed.error.message,
      );
    }
  } catch (error) {
    console.error('[scoreInterview] Gemini scoring failed, using transcript fallback', error);
  }

  const scored = parsedData ?? fallbackInterviewScore(questionsAnswered);

  const coverageAdjusted = applyCoverageAdjustment(scored, {
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
    weaknesses: finalizeCandidateWeaknesses(snippetAdjusted),
    recommendations: cleanRecommendations(snippetAdjusted.recommendations),
  };

  return omitUndefinedScoreFields(finalized);
}

/**
 * Validate a candidate scoring object without calling Gemini (for tests / fallbacks).
 */
export function validateScoreShape(value: unknown): ScoreInterviewResult {
  return scoreInterviewSchema.parse(value);
}
