import { auth, db } from "../config/firebase";
import { FieldValue } from "firebase-admin/firestore";
import {
  AuthProvider,
  LoginInput,
  LoginResult,
  OAuthResult,
  OAuthTokenInput,
  RegisterInput,
  RegisterResult,
  User,
} from "../models/user.model";

const upsertUserDocument = async (
  uid: string,
  fields: Partial<Omit<User, "isActive" | "createdAt" | "updatedAt">>
): Promise<User> => {
  const ref = db.collection("users").doc(uid);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    await ref.set({
      ...fields,
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    await ref.update({
      ...fields,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  return (await ref.get()).data() as User;
};

export const register = async ({
  name,
  email,
  password,
}: RegisterInput): Promise<RegisterResult> => {
  if (!name || !email || !password) {
    throw new Error("name, email, and password are required");
  }

  const userRecord = await auth.createUser({ email, password, displayName: name });

  const user = await upsertUserDocument(userRecord.uid, {
    uid: userRecord.uid,
    name,
    email,
    provider: "email" as AuthProvider,
  });

  const customToken = await auth.createCustomToken(userRecord.uid);

  return { user, customToken };
};

export const login = async ({ email, password }: LoginInput): Promise<LoginResult> => {
  if (!email || !password) {
    throw new Error("email and password are required");
  }

  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) throw new Error("FIREBASE_API_KEY is not configured");

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
    throw new Error(data?.error?.message ?? "Invalid email or password");
  }

  const uid = data.localId!;
  const idToken = data.idToken!;
  const userRecord = await auth.getUser(uid);

  const user = await upsertUserDocument(uid, {
    uid,
    name: userRecord.displayName ?? "",
    email,
    provider: "email" as AuthProvider,
  });

  return { user, idToken };
};

export const googleLogin = async ({ idToken }: OAuthTokenInput): Promise<OAuthResult> => {
  if (!idToken) throw new Error("idToken is required");

  const decoded = await auth.verifyIdToken(idToken);
  const { uid, name, email, picture } = decoded;

  const user = await upsertUserDocument(uid, {
    uid,
    name: name ?? "",
    email: email ?? "",
    photoURL: picture ?? "",
    provider: "google" as AuthProvider,
  });

  return { user };
};

export const githubLogin = async ({ idToken }: OAuthTokenInput): Promise<OAuthResult> => {
  if (!idToken) throw new Error("idToken is required");

  const decoded = await auth.verifyIdToken(idToken);
  const { uid, name, email, picture } = decoded;

  const user = await upsertUserDocument(uid, {
    uid,
    name: name ?? "",
    email: email ?? "",
    photoURL: picture ?? "",
    provider: "github" as AuthProvider,
  });

  return { user };
};

export const phoneLogin = async ({ idToken }: OAuthTokenInput): Promise<OAuthResult> => {
  if (!idToken) throw new Error("idToken is required");

  const decoded = await auth.verifyIdToken(idToken);
  const { uid, phone_number, name, picture } = decoded;

  const user = await upsertUserDocument(uid, {
    uid,
    name: name ?? "",
    phoneNumber: phone_number ?? "",
    photoURL: picture ?? "",
    provider: "phone" as AuthProvider,
  });

  return { user };
};

export const getCurrentUser = async (uid: string): Promise<User> => {
  const snapshot = await db.collection("users").doc(uid).get();

  if (!snapshot.exists) throw new Error("User not found");

  return snapshot.data() as User;
};

export const logout = async (uid: string): Promise<{ message: string }> => {
  await auth.revokeRefreshTokens(uid);
  return { message: "Successfully logged out" };
};
