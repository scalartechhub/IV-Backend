import { aiService } from "./ai.service";
import { buildEvaluationPrompt } from "../interview/prompts/evaluation.prompt";
import { logger } from "../../shared/logger";
import { AppError, clamp, toNumber } from "../../shared/utils";
import type { RawEvaluation } from "../interview/interview.types";

interface EvaluateAnswerParams {
  question: string;
  answer: string;
  role: string;
  difficulty: string;
  category: string;
}

export const evaluateAnswer = async (params: EvaluateAnswerParams): Promise<RawEvaluation> => {
  logger.info("[evaluation] evaluating answer", { category: params.category, difficulty: params.difficulty });

  const prompt = buildEvaluationPrompt(params);
  const result = await aiService.generateJSON<RawEvaluation>(prompt);

  if (typeof result.feedback !== "string") {
    throw new AppError(500, "AI returned invalid evaluation format. Please try again.");
  }

  const evaluation: RawEvaluation = {
    technical: clamp(Math.round(toNumber(result.technical)), 0, 10),
    communication: clamp(Math.round(toNumber(result.communication, 5)), 0, 10),
    completeness: clamp(Math.round(toNumber(result.completeness, 5)), 0, 10),
    confidence: clamp(Math.round(toNumber(result.confidence, 5)), 0, 10),
    feedback: result.feedback.trim() || "No feedback provided.",
  };

  logger.info("[evaluation] complete", {
    technical: evaluation.technical,
    communication: evaluation.communication,
  });

  return evaluation;
};
