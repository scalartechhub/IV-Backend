import { logger } from "../../shared/logger";
import { atsService } from "./atsService";
import { AtsAnalysisDoc, AtsAnalysisResult } from "./ats.types";

/**
 * Analyze a resume against a job description
 * Called directly from routes with business arguments (not Express req/res/next)
 */
export const analyzeResume = async (
  userId: string,
  resumeText: string,
  jobDescription: string,
): Promise<{ analysisId: string } & AtsAnalysisResult> => {
  logger.debug("[atsController] Starting resume analysis", { userId });

  const result = await atsService.analyzeResume(userId, resumeText, jobDescription);

  logger.info("[atsController] Resume analyzed successfully", {
    userId,
    analysisId: result.analysisId,
    matchScore: result.matchScore,
  });

  return result;
};

/**
 * Get user's analysis history
 */
export const getHistory = async (
  userId: string,
  limit: number,
): Promise<(AtsAnalysisDoc & { id: string })[]> => {
  const history = await atsService.getHistory(userId, limit);

  logger.debug("[atsController] History fetched", {
    userId,
    count: history.length,
  });

  return history;
};

/**
 * Get a specific analysis by ID
 */
export const getAnalysisById = async (
  userId: string,
  analysisId: string,
): Promise<AtsAnalysisDoc & { id: string }> => {
  const analysis = await atsService.getAnalysisById(userId, analysisId);

  logger.debug("[atsController] Analysis fetched", {
    userId,
    analysisId,
  });

  return analysis;
};

/**
 * Delete a specific analysis
 */
export const deleteAnalysis = async (
  userId: string,
  analysisId: string,
): Promise<boolean> => {
  await atsService.deleteAnalysis(userId, analysisId);

  logger.info("[atsController] Analysis deleted", { userId, analysisId });

  return true;
};