import { logger } from "../../shared/logger";
import { atsService } from "./atsService";
import { AtsAnalysisDoc, AtsAnalysisResult, ParsedResume } from "./ats.types";

export const analyzeResume = async (
  userId: string,
  resumeText: string | undefined,
  jobDescription: string | undefined,
  parsedResume?: ParsedResume,
  targetRole?: string,
): Promise<{ analysisId: string } & AtsAnalysisResult> => {
  logger.debug("[atsController] Starting resume analysis", {
    userId,
    targetRole,
  });

  const result = await atsService.analyzeResume(
    userId,
    resumeText,
    jobDescription,
    parsedResume,
    targetRole,
  );

  logger.info("[atsController] Resume analyzed successfully", {
    userId,
    analysisId: result.analysisId,
    matchScore: result.matchScore,
  });

  return result;
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
