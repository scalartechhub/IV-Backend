import { aiService } from "./ai.service";
import { buildResumeParserPrompt } from "../interview/prompts/resume-parser.prompt";
import { logger } from "../../shared/logger";
import { AppError } from "../../shared/utils";
import { extractPdfText } from "../../shared/utils/pdf";
import type { ResumeAnalysis } from "../interview/interview.types";

export const extractTextFromPDF = async (buffer: Buffer): Promise<string> => {
  try {
    const data = await extractPdfText(buffer);

    if (!data.text || data.text.length < 20) {
      throw new AppError(
        400,
        "PDF appears to be empty or unreadable. Please upload a text-based PDF."
      );
    }

    logger.debug("[resume-parser] extracted text", { chars: data.text.length, pages: data.numpages });
    return data.text;
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error("[resume-parser] PDF extraction failed", error);
    throw new AppError(400, "Failed to read PDF. Ensure the file is a valid, text-based PDF.");
  }
};

export const parseResume = async (pdfBuffer: Buffer): Promise<ResumeAnalysis> => {
  logger.info("[resume-parser] starting resume parse");

  const text = await extractTextFromPDF(pdfBuffer);
  const prompt = buildResumeParserPrompt(text);
  const analysis = await aiService.generateJSON<ResumeAnalysis>(prompt);

  if (!Array.isArray(analysis.skills)) analysis.skills = [];
  if (!Array.isArray(analysis.projects)) analysis.projects = [];
  if (!Array.isArray(analysis.experience)) analysis.experience = [];
  if (!Array.isArray(analysis.education)) analysis.education = [];

  logger.info("[resume-parser] parse complete", {
    skills: analysis.skills.length,
    projects: analysis.projects.length,
  });

  return analysis;
};
