import { randomUUID } from "crypto";
import { getStorage } from "firebase-admin/storage";
import { isStorageConfigured } from "../../config/firebase";
import { STORAGE_PATHS } from "../../shared/constants";
import { AppError } from "../../shared/utils";
import { logger } from "../../shared/logger";

/**
 * Uploads a user's resume PDF to Storage and returns the bucket-relative
 * `storagePath` (not a signed/download URL) — matches the resume analysis
 * API contract, which expects a Storage path clients resolve via the
 * Firebase Storage SDK for download/preview.
 */
export const uploadUserResumeFile = async (
  uid: string,
  buffer: Buffer,
  fileKey = `resume-${Date.now()}-${randomUUID()}`,
  contentType = "application/pdf"
): Promise<string | undefined> => {
  if (!isStorageConfigured()) {
    logger.warn("[storage] FIREBASE_STORAGE_BUCKET not set — skipping user resume upload");
    return undefined;
  }

  const bucket = getStorage().bucket();
  const filePath = STORAGE_PATHS.USER_RESUME(uid, fileKey);
  const file = bucket.file(filePath);
  const downloadToken = randomUUID();

  logger.info(`[storage] uploading user resume uid=${uid}`);

  try {
    await file.save(buffer, {
      contentType,
      gzip: false,
      metadata: {
        cacheControl: "public, max-age=31536000",
        metadata: {
          uid,
          fileType: "resume",
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });

    logger.info(`[storage] user resume upload success: ${filePath}`);
    return filePath;
  } catch (error) {
    logger.error("[storage] user resume upload failed", error);
    throw new AppError(500, "Failed to upload resume file to storage. Please try again.");
  }
};
