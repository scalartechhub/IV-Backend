import { QUESTION_DISTRIBUTION } from "../../shared/constants";
import { clamp } from "../../shared/utils";
import type { InterviewQuestion, RawEvaluation } from "./interview.types";

export const MAX_SCORE_PER_QUESTION = 10;
export const MAX_INTERVIEW_SCORE =
  QUESTION_DISTRIBUTION.TOTAL * MAX_SCORE_PER_QUESTION;

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
 * Overall interview score out of 100.
 * Each question contributes up to 10 points; unanswered questions score 0.
 */
export const calculateInterviewOverallScore = (
  questions: InterviewQuestion[]
): number => {
  let total = 0;

  for (const question of questions) {
    total += question.score ?? 0;
  }

  const maxScore = questions.length * MAX_SCORE_PER_QUESTION;
  return clamp(total, 0, maxScore > 0 ? maxScore : MAX_INTERVIEW_SCORE);
};

export const countAnsweredQuestions = (questions: InterviewQuestion[]): number =>
  questions.filter((q) => q.answer !== undefined && q.answer.length > 0).length;
