import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase";
import { COLLECTIONS } from "../../shared/constants";
import { AppError } from "../../shared/utils";
import {
  DEFAULT_USER_STATS,
  type User,
  type UserInterviewSettings,
  type UserProfile,
  type UserResumeAnalysisEntry,
} from "./auth.types";
import { DIFFICULTY_LEVELS, INTERVIEW_TYPES } from "../../shared/constants";

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
  if (!user) throw new AppError(404, "User account not found.");
  return user;
};

export const getUserProfile = async (uid: string): Promise<UserProfile> => {
  const snapshot = await db.collection(COLLECTIONS.USERS).doc(uid).get();
  if (!snapshot.exists) throw new AppError(404, "User profile not found. Please complete your profile first.");
  return snapshot.data() as UserProfile;
};

const isValidInterviewSettings = (
  settings: unknown
): settings is UserInterviewSettings => {
  if (!settings || typeof settings !== "object") return false;

  const value = settings as Record<string, unknown>;

  return (
    typeof value.difficultyLevel === "string" &&
    DIFFICULTY_LEVELS.includes(value.difficultyLevel as UserInterviewSettings["difficultyLevel"]) &&
    typeof value.interviewType === "string" &&
    INTERVIEW_TYPES.includes(value.interviewType as UserInterviewSettings["interviewType"]) &&
    typeof value.durationMinutes === "number" &&
    value.durationMinutes > 0 &&
    typeof value.questionCount === "number" &&
    value.questionCount > 0
  );
};

const normalizeInterviewSettings = (settings: unknown): UserInterviewSettings | null => {
  if (!settings || typeof settings !== "object") return null;

  const value = settings as Record<string, unknown>;
  const durationMinutes =
    typeof value.durationMinutes === "number"
      ? value.durationMinutes
      : Number(value.durationMinutes);
  const questionCount =
    typeof value.questionCount === "number" ? value.questionCount : Number(value.questionCount);

  const normalized: Partial<UserInterviewSettings> = {
    difficultyLevel:
      typeof value.difficultyLevel === "string"
        ? (value.difficultyLevel as UserInterviewSettings["difficultyLevel"])
        : undefined,
    interviewType:
      typeof value.interviewType === "string"
        ? (value.interviewType as UserInterviewSettings["interviewType"])
        : undefined,
    durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : undefined,
    questionCount: Number.isFinite(questionCount) ? questionCount : undefined,
  };

  return isValidInterviewSettings(normalized) ? normalized : null;
};

export const getUserInterviewSettings = async (uid: string): Promise<UserInterviewSettings> => {
  const settingsDoc = await db
    .collection(COLLECTIONS.USERS)
    .doc(uid)
    .collection("settings")
    .doc("settings")
    .get();

  if (settingsDoc.exists) {
    const data = settingsDoc.data() as Record<string, unknown>;
    const rawPreference =
      data.interviewPreferene ?? data.interviewPreference ?? data.interviewPreferences;
    const normalized = normalizeInterviewSettings(rawPreference);

    if (normalized) {
      return normalized;
    }
  }

  const user = await requireUserById(uid);
  const fallback = normalizeInterviewSettings(user.settings);

  if (!fallback) {
    throw new AppError(
      400,
      "Interview settings are missing. Please set difficultyLevel, durationMinutes, interviewType, and questionCount in settings under interviewPreferene."
    );
  }

  return fallback;
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
    if (!snap.exists) throw new AppError(404, "User account not found.");

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

export const appendUserResumeAnalysis = async (
  uid: string,
  entry: Omit<UserResumeAnalysisEntry, "no">
): Promise<UserResumeAnalysisEntry> => {
  const ref = db.collection(COLLECTIONS.USERS).doc(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, "User account not found.");

    const user = snap.data() as User;
    const resumeAnalyses = Array.isArray(user.resumeAnalyses) ? user.resumeAnalyses : [];
    const highestNo = resumeAnalyses.reduce((maxNo, item) => Math.max(maxNo, item.no ?? 0), 0);
    const nextEntry: UserResumeAnalysisEntry = {
      no: highestNo + 1,
      ...entry,
    };

    tx.update(ref, {
      resumeAnalyses: [...resumeAnalyses, nextEntry],
      updatedAt: FieldValue.serverTimestamp(),
    });

    return nextEntry;
  });
};
