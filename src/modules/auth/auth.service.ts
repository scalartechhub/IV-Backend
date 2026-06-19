import { auth } from "../../config/firebase";
import { secretService } from "../../config/secrets";
import { AppError } from "../../shared/utils";
import { logger } from "../../shared/logger";
import * as userRepo from "./auth.repository";
import type { AuthProvider, LoginResult, RegisterResult, User } from "./auth.types";

export const register = async (input: {
  name: string;
  email: string;
  password: string;
}): Promise<RegisterResult> => {
  const { name, email, password } = input;
  logger.info(`[auth.service] register attempt: ${email}`);

  const userRecord = await auth.createUser({ email, password, displayName: name });

  const user = await userRepo.upsertUser(userRecord.uid, {
    uid: userRecord.uid,
    name,
    email,
    provider: "email" as AuthProvider,
  });

  logger.info(`[auth.service] registered uid=${userRecord.uid}`);
  return { user };
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
    error?: { message: string };
  };

  if (!response.ok) {
    throw new AppError(401, data?.error?.message ?? "Invalid email or password");
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
