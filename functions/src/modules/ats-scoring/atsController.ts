import { logger } from "../../shared/logger";
import { atsService } from "./atsService";
import { ParsedResume, ResumeAnalysisResponse } from "./ats.types";

export const analyzeResume = async (
  userId: string,
  resumeText: string | undefined,
  jobDescription: string | undefined,
  parsedResume?: ParsedResume,
  targetRole?: string,
  resumeId?: string,
  fileName?: string,
  experience?: string,
): Promise<ResumeAnalysisResponse> => {
  logger.debug("[atsController] Starting resume analysis", {
    userId,
    resumeId,
    targetRole,
  });

  const result = await atsService.analyzeResume(
    userId,
    resumeText,
    jobDescription,
    parsedResume,
    targetRole,
    resumeId,
    fileName,
    experience,
  );

  logger.info("[atsController] Resume analyzed successfully", {
    userId,
    resumeId,
    overallScore: result.overallScore,
  });

  return result;
};

export const getAnalysisByResumeId = async (
  userId: string,
  resumeId: string,
): Promise<ResumeAnalysisResponse | null> => {
  try {
    logger.debug("[atsController] getAnalysisByResumeId called", { userId, resumeId });
    const result = await atsService.getAnalysisByResumeId(userId, resumeId);
    logger.debug("[atsController] getAnalysisByResumeId result", {
      found: result !== null,
    });
    return result;
  } catch (error) {
    logger.error("[atsController] Error in getAnalysisByResumeId", error);
    throw error;
  }
};

export const getAvailableRoles = async (): Promise<
  { id: string; title: string }[]
> => {
  return atsService.getAvailableRoles();
};

export const getHistory = async (
  userId: string,
  limit: number,
): Promise<ResumeAnalysisResponse[]> => {
  return atsService.getHistory(userId, limit);
};

export const getAnalysisById = async (
  userId: string,
  analysisId: string,
): Promise<ResumeAnalysisResponse> => {
  return atsService.getAnalysisById(userId, analysisId);
};

export const deleteAnalysis = async (
  userId: string,
  analysisId: string,
): Promise<boolean> => {
  return atsService.deleteAnalysis(userId, analysisId);
};
