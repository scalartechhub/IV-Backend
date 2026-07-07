import { aiService } from "./ai.service";
import { buildJDParserPrompt } from "../interview/prompts/jd-parser.prompt";
import { logger } from "../../shared/logger";
import { AppError } from "../../shared/utils";
import { extractPdfText } from "../../shared/utils/pdf";
import type { JDAnalysis } from "../interview/interview.types";

export const parseJD = async (pdfBuffer: Buffer): Promise<JDAnalysis> => {
  logger.info("[jd-parser] starting JD parse");

  let text: string;
  try {
    const data = await extractPdfText(pdfBuffer);
    text = data.text;

    if (!text || text.length < 20) {
      throw new AppError(400, "Job description PDF appears to be empty or unreadable.");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error("[jd-parser] PDF extraction failed", error);
    throw new AppError(400, "Failed to read JD PDF. Ensure the file is a valid, text-based PDF.");
  }

  const prompt = buildJDParserPrompt(text);
  const analysis = await aiService.generateJSON<JDAnalysis>(prompt);

  if (!Array.isArray(analysis.requiredSkills)) analysis.requiredSkills = [];
  if (!Array.isArray(analysis.responsibilities)) analysis.responsibilities = [];
  if (!Array.isArray(analysis.experience)) analysis.experience = [];

  logger.info("[jd-parser] parse complete", {
    skills: analysis.requiredSkills.length,
    responsibilities: analysis.responsibilities.length,
  });

  return analysis;
};
