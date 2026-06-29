import { randomUUID } from "crypto";
import { getStorage, getDownloadURL } from "firebase-admin/storage";
import { isStorageConfigured } from "../../config/firebase";
import { STORAGE_PATHS } from "../../shared/constants";
import { AppError } from "../../shared/utils";
import { logger } from "../../shared/logger";

export const uploadUserResumeFile = async (
  uid: string,
  buffer: Buffer,
  contentType = "application/pdf"
): Promise<string | undefined> => {
  if (!isStorageConfigured()) {
    logger.warn("[storage] FIREBASE_STORAGE_BUCKET not set — skipping user resume upload");
    return undefined;
  }

  const bucket = getStorage().bucket();
  const filePath = STORAGE_PATHS.USER_RESUME(uid, `resume-${Date.now()}-${randomUUID()}`);
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

    const publicUrl = await getDownloadURL(file);
    logger.info(`[storage] user resume upload success: ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    logger.error("[storage] user resume upload failed", error);
    throw new AppError(500, "Failed to upload resume file to storage. Please try again.");
  }
};
