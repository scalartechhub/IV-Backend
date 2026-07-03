import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase";
import { COLLECTIONS, USER_SETTINGS } from "../../shared/constants";
import { assertInterviewCreationAllowed } from "../../shared/entitlements";
import { getStartOfCurrentMonth, resolveBillingPlan } from "../../shared/plan.utils";
import { AppError } from "../../shared/utils";
import type { Interview } from "../interview/interview.types";
import {
  type User,
  type UserInterviewSettings,
  type UserNotificationPreferences,
  type UserProfile,
  type UserResumeAnalysisEntry,
} from "./auth.types";
import {
  DIFFICULTY_LEVELS,
  INTERVIEW_TYPES,
  type SubscriptionPlan,
} from "../../shared/constants";
import { PLAN_IDS } from "../../constants/payment.constants";

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


export const getUserSubscriptionPlan = async (uid: string): Promise<SubscriptionPlan> => {
  const user = await requireUserById(uid);
  const billingPlan = resolveBillingPlan(user);

  if (billingPlan === PLAN_IDS.ENTERPRISE || billingPlan === PLAN_IDS.PRO) {
    return "pro";
  }

  return "starter";
};

export const countInterviewsCreatedThisMonth = async (uid: string): Promise<number> => {
  const startOfMonth = getStartOfCurrentMonth();
  const startMs = startOfMonth.getTime();

  const snapshot = await db
    .collection(COLLECTIONS.INTERVIEWS)
    .where("userId", "==", uid)
    .where("isDeleted", "==", false)
    .get();

  return snapshot.docs.filter((doc) => {
    const interview = doc.data() as Interview;
    const createdAt = interview.createdAt;
    if (!createdAt) return false;

    const createdDate =
      typeof (createdAt as { toDate?: () => Date }).toDate === "function"
        ? (createdAt as { toDate: () => Date }).toDate()
        : new Date(createdAt as unknown as string);

    return createdDate.getTime() >= startMs;
  }).length;
};

export const assertUserCanCreateInterview = async (uid: string): Promise<void> => {
  const user = await requireUserById(uid);
  const billingPlan = resolveBillingPlan(user);
  const usedThisMonth = await countInterviewsCreatedThisMonth(uid);

  assertInterviewCreationAllowed(billingPlan, usedThisMonth);
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
  const rawDifficulty = value.difficultyLevel ?? value.difficulty;

  const normalized: Partial<UserInterviewSettings> = {
    difficultyLevel:
      typeof rawDifficulty === "string"
        ? (rawDifficulty as UserInterviewSettings["difficultyLevel"])
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

const getUserPreferenceDoc = (uid: string) =>
  db
    .collection(COLLECTIONS.USERS)
    .doc(uid)
    .collection(USER_SETTINGS.COLLECTION)
    .doc(USER_SETTINGS.PREFERENCE_DOC)
    .get();

export const getUserInterviewSettings = async (uid: string): Promise<UserInterviewSettings> => {
  const settingsDoc = await getUserPreferenceDoc(uid);

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
      "Interview settings are missing. Please set difficulty, durationMinutes, interviewType, and questionCount in settings/preference under interviewPreference."
    );
  }

  return fallback;
};

export const getUserNotificationPreferences = async (
  uid: string
): Promise<UserNotificationPreferences> => {
  const settingsDoc = await getUserPreferenceDoc(uid);

  if (!settingsDoc.exists) {
    return { feedbackReports: false, interviewReminders: false };
  }

  const data = settingsDoc.data() as Record<string, unknown>;
  const rawPreference = data.notificationPreference;

  if (!rawPreference || typeof rawPreference !== "object") {
    return { feedbackReports: false, interviewReminders: false };
  }

  const prefs = rawPreference as Record<string, unknown>;

  return {
    feedbackReports: prefs.feedbackReports === true,
    interviewReminders: prefs.interviewReminders === true,
  };
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
