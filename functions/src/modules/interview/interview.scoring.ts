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
