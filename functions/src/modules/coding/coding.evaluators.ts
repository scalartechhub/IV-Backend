/**
 * Assessment evaluators.
 *
 * Only JUDGE0 (DSA) is automated today via judge0.client + coding.service.
 * SQL_EVALUATOR and MANUAL_EVALUATION accept text answers and store them for review.
 * Do not claim automated grading for SQL/manual until a real evaluator is wired.
 */

import type { AssessmentType, ExecutionMode } from "./coding.role-classifier";
import type { CodingProblemDoc } from "./coding.types";
import { AppError } from "../../shared/utils";

export interface AssessmentEvaluator {
  readonly mode: ExecutionMode;
  /** True when the platform can auto-grade without human review. */
  readonly automated: boolean;
  supports(problem: CodingProblemDoc): boolean;
}

export class Judge0Evaluator implements AssessmentEvaluator {
  readonly mode = "JUDGE0" as const;
  readonly automated = true;

  supports(problem: CodingProblemDoc): boolean {
    const mode = problem.executionMode ?? "JUDGE0";
    const type = problem.assessmentType ?? "DSA";
    return mode === "JUDGE0" && type === "DSA";
  }
}

/** Placeholder — no live SQL engine in this repo yet. */
export class SqlEvaluatorStub implements AssessmentEvaluator {
  readonly mode = "SQL_EVALUATOR" as const;
  readonly automated = false;

  supports(problem: CodingProblemDoc): boolean {
    return (problem.executionMode ?? "") === "SQL_EVALUATOR";
  }
}

export class ManualEvaluator implements AssessmentEvaluator {
  readonly mode = "MANUAL_EVALUATION" as const;
  readonly automated = false;

  supports(problem: CodingProblemDoc): boolean {
    return (problem.executionMode ?? "") === "MANUAL_EVALUATION";
  }
}

export const judge0Evaluator = new Judge0Evaluator();
export const sqlEvaluatorStub = new SqlEvaluatorStub();
export const manualEvaluator = new ManualEvaluator();

export const resolveEvaluator = (problem: CodingProblemDoc): AssessmentEvaluator => {
  if (judge0Evaluator.supports(problem)) return judge0Evaluator;
  if (sqlEvaluatorStub.supports(problem)) return sqlEvaluatorStub;
  if (manualEvaluator.supports(problem)) return manualEvaluator;
  // Legacy docs without metadata → Judge0 path
  return judge0Evaluator;
};

export const assertJudge0Executable = (problem: CodingProblemDoc): void => {
  const evaluator = resolveEvaluator(problem);
  if (!evaluator.automated || evaluator.mode !== "JUDGE0") {
    throw new AppError(
      400,
      `This assessment uses ${problem.executionMode ?? "MANUAL_EVALUATION"} and cannot be run on Judge0. Submit a written answer instead.`
    );
  }
};

export const isAutomatedJudge0Problem = (problem: CodingProblemDoc): boolean =>
  resolveEvaluator(problem).mode === "JUDGE0" && resolveEvaluator(problem).automated;

export const defaultExecutionMeta = (
  assessmentType?: AssessmentType
): { assessmentType: AssessmentType; executionMode: ExecutionMode } => {
  const type = assessmentType ?? "DSA";
  if (type === "DSA") return { assessmentType: "DSA", executionMode: "JUDGE0" };
  if (type === "SQL") return { assessmentType: "SQL", executionMode: "SQL_EVALUATOR" };
  return { assessmentType: type, executionMode: "MANUAL_EVALUATION" };
};
