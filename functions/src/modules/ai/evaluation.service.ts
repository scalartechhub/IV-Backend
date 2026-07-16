import { aiService } from "./ai.service";
import {
  buildEvaluationPrompt,
  buildBatchEvaluationPrompt,
  type BatchEvaluationItem,
} from "../interview/prompts/evaluation.prompt";
import { logger } from "../../shared/logger";
import { AppError, clamp, toNumber } from "../../shared/utils";
import type { RawEvaluation, RawBatchEvaluation } from "../interview/interview.types";

interface EvaluateAnswerParams {
  question: string;
  answer: string;
  role: string;
  difficulty: string;
  category: string;
}

interface EvaluateAnswersBatchParams {
  technology: string;
  items: BatchEvaluationItem[];
}

const normalizeEvaluation = (result: RawEvaluation): RawEvaluation => {
  if (typeof result.feedback !== "string") {
    throw new AppError(500, "AI returned invalid evaluation format. Please try again.");
  }

  return {
    technical: clamp(Math.round(toNumber(result.technical)), 0, 10),
    communication: clamp(Math.round(toNumber(result.communication)), 0, 10),
    completeness: clamp(Math.round(toNumber(result.completeness)), 0, 10),
    confidence: clamp(Math.round(toNumber(result.confidence)), 0, 10),
    feedback: result.feedback.trim() || "No feedback provided.",
  };
};

export const evaluateAnswer = async (params: EvaluateAnswerParams): Promise<RawEvaluation> => {
  logger.info("[evaluation] evaluating answer", {
    category: params.category,
    difficulty: params.difficulty,
  });

  const prompt = buildEvaluationPrompt(params);
  const result = await aiService.generateJSON<RawEvaluation>(prompt);
  const evaluation = normalizeEvaluation(result);

  logger.info("[evaluation] complete", {
    technical: evaluation.technical,
    communication: evaluation.communication,
  });

  return evaluation;
};

export const evaluateAnswersBatch = async (
  params: EvaluateAnswersBatchParams
): Promise<Map<string, RawEvaluation>> => {
  logger.info("[evaluation] batch evaluating answers", { count: params.items.length });

  const prompt = buildBatchEvaluationPrompt(params);
  const results = await aiService.generateJSON<RawBatchEvaluation[]>(prompt, 8192);

  if (!Array.isArray(results) || results.length === 0) {
    throw new AppError(500, "AI returned invalid batch evaluation format. Please try again.");
  }

  const expectedIds = new Set(params.items.map((item) => item.questionId));
  const evaluations = new Map<string, RawEvaluation>();

  for (const result of results) {
    if (typeof result.questionId !== "string" || !expectedIds.has(result.questionId)) {
      continue;
    }
    if (evaluations.has(result.questionId)) continue;

    evaluations.set(result.questionId, normalizeEvaluation(result));
  }

  if (evaluations.size !== params.items.length) {
    throw new AppError(
      500,
      `AI returned ${evaluations.size}/${params.items.length} evaluations. Please try again.`
    );
  }

  logger.info("[evaluation] batch complete", { count: evaluations.size });
  return evaluations;
};
