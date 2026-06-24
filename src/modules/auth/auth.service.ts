import { auth } from "../../config/firebase";
import { secretService } from "../../config/secrets";
import { Timestamp } from "firebase-admin/firestore";
import { AppError } from "../../shared/utils";
import { logger } from "../../shared/logger";
import { mapFirebaseLoginError } from "../../shared/errors";
import { parseResume } from "../ai/resume-parser.service";
import { uploadUserResumeFile } from "../storage/storage.service";
import * as userRepo from "./auth.repository";
import type {
  AuthProvider,
  LoginResult,
  RegisterResult,
  User,
  UserResumeAnalysisEntry,
} from "./auth.types";

export const register = async (input: {
  name: string;
  email: string;
  password: string;
}): Promise<RegisterResult> => {
  const { name, email, password } = input;
  logger.info(`[auth.service] register attempt: ${email}`);

  try {
    const userRecord = await auth.createUser({ email, password, displayName: name });

    const user = await userRepo.upsertUser(userRecord.uid, {
      uid: userRecord.uid,
      name,
      email,
      provider: "email" as AuthProvider,
    });

    logger.info(`[auth.service] registered uid=${userRecord.uid}`);
    return { user };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "auth/email-already-exists") {
      throw new AppError(409, "An account with this email already exists. Please log in instead.");
    }
    if (code === "auth/invalid-email") {
      throw new AppError(400, "Please enter a valid email address.");
    }
    if (code === "auth/weak-password") {
      throw new AppError(400, "Password is too weak. Use at least 6 characters.");
    }
    throw new AppError(400, "Registration failed. Please check your details and try again.");
  }
};

export const login = async (input: {
  email: string;
  password: string;
}): Promise<LoginResult> => {
  const { email, password } = input;
  logger.info(`[auth.service] login attempt: ${email}`);

  const apiKey = secretService.getFirebaseApiKey();

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );

  const data = (await response.json()) as {
    localId?: string;
    idToken?: string;
    error?: { message: string; code?: number };
  };

  if (!response.ok) {
    throw new AppError(401, mapFirebaseLoginError(data?.error?.message));
  }

  const uid = data.localId!;
  const idToken = data.idToken!;
  const userRecord = await auth.getUser(uid);

  const user = await userRepo.upsertUser(uid, {
    uid,
    name: userRecord.displayName ?? "",
    email,
    provider: "email" as AuthProvider,
  });

  logger.info(`[auth.service] login success uid=${uid}`);
  return { user, idToken };
};

export const logout = async (uid: string): Promise<void> => {
  await auth.revokeRefreshTokens(uid);
  logger.info(`[auth.service] logout uid=${uid}`);
};

export const uploadResumeAnalysis = async (
  uid: string,
  fileBuffer: Buffer
): Promise<UserResumeAnalysisEntry> => {
  logger.info(`[auth.service] user resume upload uid=${uid}`);

  const analysis = await parseResume(fileBuffer);

  let resumeUrl: string | undefined;
  try {
    resumeUrl = await uploadUserResumeFile(uid, fileBuffer);
  } catch (storageError) {
    logger.warn(`[auth.service] user resume storage upload failed uid=${uid}`, storageError);
  }

  const entry = await userRepo.appendUserResumeAnalysis(uid, {
    resumeUrl,
    analysis,
    uploadedAt: Timestamp.now(),
  });

  return entry;
};
