import { createHash } from "crypto";
import { CODING_EXECUTION } from "../../shared/constants";
import { AppError } from "../../shared/utils";

const activeByUid = new Map<string, number>();

/**
 * Limits concurrent coding executions per uid within this process.
 * Cloud Functions are multi-instance, so this is best-effort per instance.
 */
export const withCodingExecutionSlot = async <T>(
  uid: string,
  fn: () => Promise<T>
): Promise<T> => {
  const current = activeByUid.get(uid) ?? 0;
  if (current >= CODING_EXECUTION.MAX_CONCURRENT_PER_UID) {
    throw new AppError(
      429,
      "A coding execution is already in progress. Please wait for it to finish."
    );
  }

  activeByUid.set(uid, current + 1);
  try {
    return await fn();
  } finally {
    const left = (activeByUid.get(uid) ?? 1) - 1;
    if (left <= 0) {
      activeByUid.delete(uid);
    } else {
      activeByUid.set(uid, left);
    }
  }
};

export const normalizeIdempotencyKey = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > CODING_EXECUTION.IDEMPOTENCY_KEY_MAX_LEN) {
    throw new AppError(400, "Idempotency-Key is too long");
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) {
    throw new AppError(400, "Idempotency-Key contains invalid characters");
  }
  return trimmed;
};

export const hashSourceCode = (sourceCode: string): string =>
  createHash("sha256").update(sourceCode, "utf8").digest("hex");
