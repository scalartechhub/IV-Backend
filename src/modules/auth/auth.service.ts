import { auth } from "../../config/firebase";
import { secretService } from "../../config/secrets";
import { AppError } from "../../shared/utils";
import { logger } from "../../shared/logger";
import * as userRepo from "./auth.repository";
import type {
  AuthProvider,
  LoginResult,
  OAuthResult,
  RegisterResult,
  User,
} from "./auth.types";

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

  const customToken = await auth.createCustomToken(userRecord.uid);
  logger.info(`[auth.service] registered uid=${userRecord.uid}`);

  return { user, customToken };
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

export const googleLogin = async (input: { idToken: string }): Promise<OAuthResult> => {
  const decoded = await auth.verifyIdToken(input.idToken);
  const { uid, name, email, picture } = decoded;

  const user = await userRepo.upsertUser(uid, {
    uid,
    name: name ?? "",
    email: email ?? "",
    photoURL: picture ?? "",
    provider: "google" as AuthProvider,
  });

  logger.info(`[auth.service] google login uid=${uid}`);
  return { user };
};

export const githubLogin = async (input: { idToken: string }): Promise<OAuthResult> => {
  const decoded = await auth.verifyIdToken(input.idToken);
  const { uid, name, email, picture } = decoded;

  const user = await userRepo.upsertUser(uid, {
    uid,
    name: name ?? "",
    email: email ?? "",
    photoURL: picture ?? "",
    provider: "github" as AuthProvider,
  });

  logger.info(`[auth.service] github login uid=${uid}`);
  return { user };
};

export const phoneLogin = async (input: { idToken: string }): Promise<OAuthResult> => {
  const decoded = await auth.verifyIdToken(input.idToken);
  const { uid, phone_number, name, picture } = decoded;

  const user = await userRepo.upsertUser(uid, {
    uid,
    name: name ?? "",
    phoneNumber: phone_number ?? "",
    photoURL: picture ?? "",
    provider: "phone" as AuthProvider,
  });

  logger.info(`[auth.service] phone login uid=${uid}`);
  return { user };
};

export const getCurrentUser = async (uid: string): Promise<User> => {
  return userRepo.requireUserById(uid);
};

export const logout = async (uid: string): Promise<void> => {
  await auth.revokeRefreshTokens(uid);
  logger.info(`[auth.service] logout uid=${uid}`);
};
