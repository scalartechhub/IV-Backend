import { DEFAULT_QUESTION_COUNT } from "../../shared/constants";
import { clamp } from "../../shared/utils";
import type { InterviewQuestion, InterviewTotalScore, RawEvaluation } from "./interview.types";

export const MAX_SCORE_PER_QUESTION = 10;
export const MAX_INTERVIEW_SCORE =
  DEFAULT_QUESTION_COUNT * MAX_SCORE_PER_QUESTION;

/** Per-question score (0–10) from the average of the four evaluation dimensions. */
export const getRawEvaluationScore = (evaluation: RawEvaluation): number => {
  const average =
    (evaluation.technical +
      evaluation.communication +
      evaluation.completeness +
      evaluation.confidence) /
    4;
  return clamp(Math.round(average), 0, MAX_SCORE_PER_QUESTION);
};

/**
 * Total interview score as earned points / maximum (per-question sum).
 * Each question contributes up to 10 points; unanswered questions score 0.
 * Overall report score (0–100) comes from AI analysis of all answers, not this total.
 */
export const calculateInterviewTotalScore = (
  questions: InterviewQuestion[]
): InterviewTotalScore => {
  let score = 0;

  for (const question of questions) {
    score += question.score ?? 0;
  }

  const outOf =
    questions.length > 0
      ? questions.length * MAX_SCORE_PER_QUESTION
      : MAX_INTERVIEW_SCORE;

  return {
    score: clamp(score, 0, outOf),
    outOf,
  };
};

export const countAnsweredQuestions = (questions: InterviewQuestion[]): number =>
  questions.filter((q) => q.answer !== undefined && q.answer.length > 0).length;

export interface DimensionAverages {
  technical: number;
  communication: number;
  completeness: number;
  confidence: number;
}

/** Averages each 0–10 evaluation dimension across answered questions and scales to 0–100 for reports. */
export const calculateDimensionAverages = (
  questions: InterviewQuestion[]
): DimensionAverages => {
  const answered = questions.filter((q) => (q.answer ?? "").trim().length > 0);

  if (answered.length === 0) {
    return { technical: 0, communication: 0, completeness: 0, confidence: 0 };
  }

  const totals = answered.reduce(
    (acc, q) => ({
      technical: acc.technical + (q.technicalScore ?? 0),
      communication: acc.communication + (q.communicationScore ?? 0),
      completeness: acc.completeness + (q.completenessScore ?? 0),
      confidence: acc.confidence + (q.confidenceScore ?? 0),
    }),
    { technical: 0, communication: 0, completeness: 0, confidence: 0 }
  );

  const toPercent = (sum: number): number =>
    clamp(Math.round((sum / answered.length) * 10), 0, 100);

  return {
    technical: toPercent(totals.technical),
    communication: toPercent(totals.communication),
    completeness: toPercent(totals.completeness),
    confidence: toPercent(totals.confidence),
  };
};

/** Blends technical/communication/confidence with the AI overall score into a single hiring signal. */
export const calculateHiringProbability = (
  dimensions: DimensionAverages,
  overallScore: number
): number =>
  clamp(
    Math.round(
      dimensions.technical * 0.3 +
        dimensions.communication * 0.25 +
        dimensions.confidence * 0.25 +
        overallScore * 0.2
    ),
    0,
    100
  );

/**
 * Prefer the AI report overall score, but never invent points when the
 * candidate demonstrated no knowledge (all empty / zero-scored answers).
 */
export const resolveOverallScore = (
  aiOverallScore: number,
  totalScore: InterviewTotalScore
): number => {
  if (totalScore.score <= 0) return 0;
  return clamp(Math.round(aiOverallScore), 0, 100);
};
