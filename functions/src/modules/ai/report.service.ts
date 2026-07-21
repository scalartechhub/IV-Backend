import { aiService } from "./ai.service";
import { throwAiResponseError } from "./ai.errors";
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
    throw new AppError(
      400,
      "Cannot create a report because this interview has no questions yet."
    );
  }

  const prompt = buildReportPrompt(params);
  const result = await aiService.generateJSON<RawReport>(prompt);

  const overallScore = toNumber(result.overallScore, NaN);
  if (Number.isNaN(overallScore)) {
    throwAiResponseError(
      "report",
      "We could not calculate your interview score. Please try again.",
      {
        missingField: "overallScore",
        expected: "a number between 0 and 100, e.g. 72",
        received: result.overallScore,
        fixSteps: [
          "Retry generating the report — Gemini sometimes skips the score field.",
          "Make sure the interview has at least one answered question.",
          "Check Gemini API quota and model availability in server logs.",
        ],
      }
    );
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
