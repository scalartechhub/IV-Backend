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
      console.warn(
        `[JD] Job description PDF has no readable text.\n` +
          `  WHAT THIS MEANS: The uploaded JD PDF is empty, scanned as images only, or corrupted.\n` +
          `  HOW TO FIX:\n` +
          `  1. Upload a text-based PDF (not a scanned photo/image PDF).\n` +
          `  2. Copy the JD text into Word/Google Docs and export as PDF.\n` +
          `  3. Try a different PDF file.`
      );
      throw new AppError(
        400,
        "Your job description PDF is empty or unreadable. Please upload a text-based PDF."
      );
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error("[jd-parser] PDF extraction failed", error);
    console.error(
      `[JD] Could not read the job description PDF.\n` +
        `  WHAT THIS MEANS: The file is corrupted or not a valid PDF.\n` +
        `  HOW TO FIX:\n` +
        `  1. Make sure the file extension is .pdf.\n` +
        `  2. Re-export the job description as PDF and upload again.\n` +
        `  3. Keep file size under 10 MB.`
    );
    throw new AppError(
      400,
      "Could not read your job description PDF. Please upload a valid, text-based PDF file."
    );
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
