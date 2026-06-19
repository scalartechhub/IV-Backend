import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase";
import { COLLECTIONS } from "../../shared/constants";
import { AppError } from "../../shared/utils";
import { DEFAULT_USER_STATS, type User, type UserProfile } from "./auth.types";

const normalizeUserFields = (
  fields: Partial<Omit<User, "isActive" | "createdAt" | "updatedAt">>
): Record<string, unknown> => {
  const normalized = { ...fields } as Record<string, unknown>;

  if (fields.name && !fields.displayName) {
    normalized.displayName = fields.name;
  }

  return normalized;
};

export const upsertUser = async (
  uid: string,
  fields: Partial<Omit<User, "isActive" | "createdAt" | "updatedAt">>
): Promise<User> => {
  const ref = db.collection(COLLECTIONS.USERS).doc(uid);
  const snapshot = await ref.get();
  const payload = normalizeUserFields(fields);

  if (!snapshot.exists) {
    await ref.set({
      ...DEFAULT_USER_STATS,
      ...payload,
      uid,
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    await ref.update({
      ...payload,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  return (await ref.get()).data() as User;
};

export const findUserById = async (uid: string): Promise<User | null> => {
  const snapshot = await db.collection(COLLECTIONS.USERS).doc(uid).get();
  return snapshot.exists ? (snapshot.data() as User) : null;
};

export const requireUserById = async (uid: string): Promise<User> => {
  const user = await findUserById(uid);
  if (!user) throw new AppError(404, "User not found");
  return user;
};

export const getUserProfile = async (uid: string): Promise<UserProfile> => {
  const snapshot = await db.collection(COLLECTIONS.USERS).doc(uid).get();
  if (!snapshot.exists) throw new AppError(404, "User profile not found");
  return snapshot.data() as UserProfile;
};

export const incrementTotalInterviews = async (uid: string): Promise<void> => {
  const ref = db.collection(COLLECTIONS.USERS).doc(uid);
  await ref.update({
    totalInterviews: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });
};

export const updateUserStatsOnCompletion = async (
  uid: string,
  interviewScore: number
): Promise<User> => {
  const ref = db.collection(COLLECTIONS.USERS).doc(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, "User not found");

    const user = snap.data() as User;
    const completedInterviews = (user.completedInterviews ?? 0) + 1;
    const previousTotal = (user.averageScore ?? 0) * (user.completedInterviews ?? 0);
    const averageScore = Math.round((previousTotal + interviewScore) / completedInterviews);
    const bestScore = Math.max(user.bestScore ?? 0, interviewScore);

    tx.update(ref, {
      completedInterviews,
      averageScore,
      bestScore,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      ...user,
      completedInterviews,
      averageScore,
      bestScore,
    };
  });
};

export const updateUserResumeUrl = async (uid: string, resumeUrl: string): Promise<void> => {
  await db.collection(COLLECTIONS.USERS).doc(uid).update({
    resumeUrl,
    updatedAt: FieldValue.serverTimestamp(),
  });
};
