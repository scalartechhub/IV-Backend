import { QUESTION_DISTRIBUTION } from "../../shared/constants";
import { clamp } from "../../shared/utils";
import type { Evaluation, Question } from "./interview.types";

export const MAX_SCORE_PER_QUESTION = 10;
export const MAX_INTERVIEW_SCORE =
  QUESTION_DISTRIBUTION.TOTAL * MAX_SCORE_PER_QUESTION;

/** Per-question score (0–10) from the average of the four evaluation dimensions. */
export const getEvaluationQuestionScore = (evaluation: Evaluation): number => {
  const average =
    (evaluation.technical +
      evaluation.communication +
      evaluation.completeness +
      evaluation.confidence) /
    4;
  return clamp(Math.round(average), 0, MAX_SCORE_PER_QUESTION);
};

const latestEvaluationByQuestion = (
  evaluations: Evaluation[]
): Map<string, Evaluation> => {
  const map = new Map<string, Evaluation>();
  for (const evaluation of evaluations) {
    const existing = map.get(evaluation.questionId);
    if (
      !existing ||
      evaluation.createdAt.toMillis() > existing.createdAt.toMillis()
    ) {
      map.set(evaluation.questionId, evaluation);
    }
  }
  return map;
};

/**
 * Overall interview performance out of 100.
 * Each question contributes up to 10 points; unanswered questions score 0.
 */
export const calculateInterviewOverallPerformance = (
  questions: Question[],
  evaluations: Evaluation[]
): number => {
  const evalByQuestion = latestEvaluationByQuestion(evaluations);
  let total = 0;

  for (const question of questions) {
    const evaluation = evalByQuestion.get(question.id);
    total += evaluation ? getEvaluationQuestionScore(evaluation) : 0;
  }

  const maxScore = questions.length * MAX_SCORE_PER_QUESTION;
  return clamp(total, 0, maxScore > 0 ? maxScore : MAX_INTERVIEW_SCORE);
};
