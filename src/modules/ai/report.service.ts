import { aiService } from "./ai.service";
import { buildReportPrompt } from "../interview/prompts/report.prompt";
import { logger } from "../../shared/logger";
import { AppError, clamp, toNumber } from "../../shared/utils";
import type { Question, Answer, Evaluation, RawReport } from "../interview/interview.types";

interface GenerateReportParams {
  role: string;
  experience: string;
  questions: Question[];
  answers: Answer[];
  evaluations: Evaluation[];
}

export const generateReport = async (params: GenerateReportParams): Promise<RawReport> => {
  logger.info("[report] generating final report", {
    role: params.role,
    questions: params.questions.length,
    answers: params.answers.length,
    evaluations: params.evaluations.length,
  });

  if (params.questions.length === 0) {
    throw new AppError(400, "Cannot generate report: no questions found for this interview.");
  }

  const prompt = buildReportPrompt(params);
  const result = await aiService.generateJSON<RawReport>(prompt);

  const overallScore = toNumber(result.overallScore, NaN);
  if (Number.isNaN(overallScore)) {
    throw new AppError(500, "AI returned invalid report format. Please try again.");
  }

  const report: RawReport = {
    overallScore: clamp(Math.round(overallScore), 0, 100),
    strengths: Array.isArray(result.strengths) ? result.strengths : [],
    weaknesses: Array.isArray(result.weaknesses) ? result.weaknesses : [],
    recommendations: Array.isArray(result.recommendations) ? result.recommendations : [],
  };

  logger.info("[report] generation complete", { overallScore: report.overallScore });
  return report;
};
