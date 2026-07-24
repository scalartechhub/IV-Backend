import { aiService } from "./ai.service";
import { buildResumeParserPrompt } from "../interview/prompts/resume-parser.prompt";
import { logger } from "../../shared/logger";
import { AppError } from "../../shared/utils";
import { extractPdfText } from "../../shared/utils/pdf";
import type { ResumeAnalysis } from "../interview/interview.types";
import { DIFFICULTY_LEVELS, INTERVIEW_TYPES } from "../../shared/constants";

export const extractTextFromPDF = async (buffer: Buffer): Promise<string> => {
  try {
    const data = await extractPdfText(buffer);

    if (!data.text || data.text.length < 20) {
      console.warn(
        `[Resume] PDF has no readable text.\n` +
          `  WHAT THIS MEANS: The uploaded PDF is empty, scanned as images only, or corrupted.\n` +
          `  HOW TO FIX:\n` +
          `  1. Upload a text-based PDF (not a scanned photo/image PDF).\n` +
          `  2. Re-export the resume from Word/Google Docs as PDF.\n` +
          `  3. Try a different PDF file.`
      );
      throw new AppError(
        400,
        "Your resume PDF is empty or unreadable. Please upload a text-based PDF."
      );
    }

    logger.debug("[resume-parser] extracted text", { chars: data.text.length, pages: data.numpages });
    return data.text;
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error("[resume-parser] PDF extraction failed", error);
    console.error(
      `[Resume] Could not read the PDF file.\n` +
        `  WHAT THIS MEANS: The file is corrupted or not a valid PDF.\n` +
        `  HOW TO FIX:\n` +
        `  1. Make sure the file extension is .pdf.\n` +
        `  2. Re-download or re-export the resume and upload again.\n` +
        `  3. Keep file size under 10 MB.`
    );
    throw new AppError(
      400,
      "Could not read your resume PDF. Please upload a valid, text-based PDF file."
    );
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

  const normalizedInterviewType =
    typeof analysis.interviewType === "string" ? analysis.interviewType.trim() : "";
  const normalizedDifficultyLevel =
    typeof analysis.difficultyLevel === "string" ? analysis.difficultyLevel.trim() : "";

  analysis.fullName =
    typeof analysis.fullName === "string" && analysis.fullName.trim().length > 0
      ? analysis.fullName.trim()
      : undefined;
  analysis.email =
    typeof analysis.email === "string" && analysis.email.trim().length > 0
      ? analysis.email.trim()
      : undefined;
  analysis.phone =
    typeof analysis.phone === "string" && analysis.phone.trim().length > 0
      ? analysis.phone.trim()
      : undefined;
  analysis.location =
    typeof analysis.location === "string" && analysis.location.trim().length > 0
      ? analysis.location.trim()
      : undefined;
  analysis.yearsOfExperience =
    typeof analysis.yearsOfExperience === "string" && analysis.yearsOfExperience.trim().length > 0
      ? analysis.yearsOfExperience.trim()
      : undefined;
  analysis.targetRole =
    typeof analysis.targetRole === "string" && analysis.targetRole.trim().length > 0
      ? analysis.targetRole.trim()
      : undefined;
  analysis.domain =
    typeof analysis.domain === "string" && analysis.domain.trim().length > 0
      ? analysis.domain.trim()
      : undefined;
  analysis.category =
    typeof analysis.category === "string" && analysis.category.trim().length > 0
      ? analysis.category.trim()
      : undefined;
  analysis.specification =
    typeof analysis.specification === "string" && analysis.specification.trim().length > 0
      ? analysis.specification.trim()
      : undefined;
  analysis.interviewType = INTERVIEW_TYPES.includes(
    normalizedInterviewType as (typeof INTERVIEW_TYPES)[number]
  )
    ? (normalizedInterviewType as ResumeAnalysis["interviewType"])
    : undefined;
  analysis.difficultyLevel = DIFFICULTY_LEVELS.includes(
    normalizedDifficultyLevel as (typeof DIFFICULTY_LEVELS)[number]
  )
    ? (normalizedDifficultyLevel as ResumeAnalysis["difficultyLevel"])
    : undefined;

  logger.info("[resume-parser] parse complete", {
    skills: analysis.skills.length,
    projects: analysis.projects.length,
    targetRole: analysis.targetRole,
  });

  return analysis;
};
