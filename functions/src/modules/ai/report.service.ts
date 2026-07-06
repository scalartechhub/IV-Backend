import { aiService } from "./ai.service";
import { buildReportPrompt } from "../interview/prompts/report.prompt";
import { logger } from "../../shared/logger";
import { AppError, clamp, toNumber } from "../../shared/utils";
import type { InterviewQuestion, RawReport } from "../interview/interview.types";

interface GenerateReportParams {
  technology: string;
  experienceLevel: string;
  questions: InterviewQuestion[];
}

export const generateReport = async (params: GenerateReportParams): Promise<RawReport> => {
  logger.info("[report] generating final report", {
    technology: params.technology,
    questions: params.questions.length,
    answered: params.questions.filter((q) => q.answer).length,
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
    summary:
      typeof result.summary === "string" && result.summary.trim()
        ? result.summary.trim()
        : "Interview completed.",
  };

  logger.info("[report] generation complete", { overallScore: report.overallScore });
  return report;
};
