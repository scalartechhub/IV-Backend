import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase";
import { COLLECTIONS } from "../../shared/constants";
import { logger } from "../../shared/logger";
import type { ResumeAnalysisResponse } from "../ats-scoring/ats.types";

/**
 * Upsert the user's current scorecard at `resumes/{userId}`.
 * One doc per user — re-analysis overwrites scores; `createdAt` is kept.
 * No PDF / storage URL is stored.
 */
export const upsertResumeAnalysis = async (
  userId: string,
  analysis: ResumeAnalysisResponse
): Promise<ResumeAnalysisResponse> => {
  const ref = db.collection(COLLECTIONS.RESUMES).doc(userId);
  const existing = await ref.get();
  const now = FieldValue.serverTimestamp();

  const payload: ResumeAnalysisResponse = {
    ...analysis,
    resumeId: userId,
  };

  await ref.set({
    ...payload,
    userId,
    createdAt: existing.exists ? (existing.get("createdAt") ?? now) : now,
    updatedAt: now,
  });

  logger.info("[resume.repository] upserted resume analysis", {
    resumeId: userId,
    userId,
    overallScore: payload.overallScore,
    isUpdate: existing.exists,
  });

  return payload;
};
