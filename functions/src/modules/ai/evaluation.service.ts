import { aiService } from "./ai.service";
import { throwAiResponseError } from "./ai.errors";
import {
  buildEvaluationPrompt,
  buildBatchEvaluationPrompt,
  type BatchEvaluationItem,
} from "../interview/prompts/evaluation.prompt";
import { logger } from "../../shared/logger";
import { clamp, toNumber } from "../../shared/utils";
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

const toEvaluationFeedback = (value: unknown): string => {
  if (typeof value === "string" && value.trim()) return value.trim();
  return "Feedback was not provided by the AI evaluator.";
};

const normalizeEvaluation = (result: RawEvaluation): RawEvaluation => {
  return {
    technical: clamp(Math.round(toNumber(result.technical)), 0, 10),
    communication: clamp(Math.round(toNumber(result.communication)), 0, 10),
    completeness: clamp(Math.round(toNumber(result.completeness)), 0, 10),
    confidence: clamp(Math.round(toNumber(result.confidence)), 0, 10),
    feedback: toEvaluationFeedback(result.feedback),
  };
};

const asBatchResults = (raw: unknown): RawBatchEvaluation[] => {
  if (Array.isArray(raw)) return raw as RawBatchEvaluation[];
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record.evaluations)) return record.evaluations as RawBatchEvaluation[];
    if (Array.isArray(record.results)) return record.results as RawBatchEvaluation[];
    if ("questionId" in record || "technical" in record || "feedback" in record) {
      return [raw as RawBatchEvaluation];
    }
  }
  return [];
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

const evaluateItemsIndividually = async (
  technology: string,
  items: BatchEvaluationItem[]
): Promise<Map<string, RawEvaluation>> => {
  const evaluations = new Map<string, RawEvaluation>();

  for (const item of items) {
    const evaluation = await evaluateAnswer({
      question: item.question,
      answer: item.answer,
      role: technology,
      difficulty: item.difficulty,
      category: item.category,
    });
    evaluations.set(item.questionId, evaluation);
  }

  return evaluations;
};

const collectBatchEvaluations = (
  items: BatchEvaluationItem[],
  results: RawBatchEvaluation[]
): Map<string, RawEvaluation> => {
  const expectedIds = new Set(items.map((item) => item.questionId));
  const evaluations = new Map<string, RawEvaluation>();
  const unmatched: RawBatchEvaluation[] = [];

  for (const result of results) {
    const questionId = typeof result.questionId === "string" ? result.questionId.trim() : "";

    if (!questionId || !expectedIds.has(questionId) || evaluations.has(questionId)) {
      unmatched.push(result);
      continue;
    }

    evaluations.set(questionId, normalizeEvaluation(result));
  }

  // If Gemini dropped/changed questionIds, fill remaining slots by response order.
  if (evaluations.size < items.length && unmatched.length > 0) {
    for (const item of items) {
      if (evaluations.has(item.questionId)) continue;
      const next = unmatched.shift();
      if (!next) break;
      evaluations.set(item.questionId, normalizeEvaluation(next));
    }
  }

  return evaluations;
};

export const evaluateAnswersBatch = async (
  params: EvaluateAnswersBatchParams
): Promise<Map<string, RawEvaluation>> => {
  const { technology, items } = params;

  if (items.length === 0) {
    return new Map();
  }

  // Single answer: skip batch prompt entirely.
  if (items.length === 1) {
    return evaluateItemsIndividually(technology, items);
  }

  logger.info("[evaluation] batch evaluating answers", { count: items.length });

  let evaluations = new Map<string, RawEvaluation>();

  try {
    const prompt = buildBatchEvaluationPrompt(params);
    const raw = await aiService.generateJSON<unknown>(prompt, 8192);
    const results = asBatchResults(raw);

    if (results.length === 0) {
      logger.warn("[evaluation] batch returned no usable results; falling back to individual evaluation");
    } else {
      evaluations = collectBatchEvaluations(items, results);
    }
  } catch (error) {
    logger.warn(
      "[evaluation] batch evaluation failed; falling back to individual evaluation",
      error instanceof Error ? error.message : error
    );
  }

  const missingItems = items.filter((item) => !evaluations.has(item.questionId));

  if (missingItems.length > 0) {
    logger.warn("[evaluation] completing missing evaluations individually", {
      missing: missingItems.length,
      questionIds: missingItems.map((item) => item.questionId),
    });

    const filled = await evaluateItemsIndividually(technology, missingItems);
    for (const [questionId, evaluation] of filled) {
      evaluations.set(questionId, evaluation);
    }
  }

  if (evaluations.size !== items.length) {
    throwAiResponseError(
      "batch-evaluation",
      "Some answers could not be evaluated. Please try again.",
      {
        missingField: "questionId / evaluation entries",
        expected: `${items.length} evaluations (one per question)`,
        received: `${evaluations.size} valid evaluations returned`,
        fixSteps: [
          "Retry finishing the interview — evaluation can fail temporarily.",
          "Check Gemini API key and quota in your .env file.",
          "If it keeps failing, check server logs for [evaluation] and [Gemini] details.",
        ],
      }
    );
  }

  logger.info("[evaluation] batch complete", { count: evaluations.size });
  return evaluations;
};
