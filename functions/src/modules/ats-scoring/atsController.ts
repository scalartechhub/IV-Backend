import { logger } from "../../shared/logger";
import { atsService } from "./atsService";
import { AtsAnalysisDoc, AtsAnalysisResult, ParsedResume } from "./ats.types";

export const analyzeResume = async (
  userId: string,
  resumeText: string | undefined,
  jobDescription: string | undefined,
  parsedResume?: ParsedResume,
  targetRole?: string,
  resumeId?: string,
): Promise<{ analysisId: string } & AtsAnalysisResult> => {
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
  );

  logger.info("[atsController] Resume analyzed successfully", {
    userId,
    resumeId,
    analysisId: result.analysisId,
    matchScore: result.matchScore,
  });

  return result;
};

export const getAnalysisByResumeId = async (
  userId: string,
  resumeId: string,
): Promise<AtsAnalysisDoc | null> => {
  try {
    logger.debug("[atsController] getAnalysisByResumeId called", { userId, resumeId });
    const result = await atsService.getAnalysisByResumeId(userId, resumeId);
    logger.debug("[atsController] getAnalysisByResumeId result", { 
      found: result !== null,
      result 
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
): Promise<AtsAnalysisDoc[]> => {
  return atsService.getHistory(userId, limit);
};

export const getAnalysisById = async (
  userId: string,
  analysisId: string,
): Promise<AtsAnalysisDoc> => {
  return atsService.getAnalysisById(userId, analysisId);
};

export const deleteAnalysis = async (
  userId: string,
  analysisId: string,
): Promise<boolean> => {
  return atsService.deleteAnalysis(userId, analysisId);
};