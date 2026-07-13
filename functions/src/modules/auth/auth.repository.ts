import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../../config/firebase";
import { COLLECTIONS } from "../../shared/constants";
import { assertInterviewCreationAllowed } from "../../shared/entitlements";
import { getStartOfCurrentMonth, resolveBillingPlan } from "../../shared/plan.utils";
import { AppError } from "../../shared/utils";
import type { Interview } from "../interview/interview.types";
import {
  DEFAULT_USER_PREFERENCES,
  DEFAULT_USER_SUBSCRIPTION,
  type User,
  type UserAnalytics,
  type UserInterviewSettings,
  type UserNotificationPreferences,
  type UserResumeAnalysisEntry,
  type UserStats,
  type RadarSkill,
  type DomainPerformance,
  type InterviewTypeStat,
  type MonthlyPerformance,
  type RecentScore,
} from "./auth.types";
import { DIFFICULTY_LEVELS, type SubscriptionPlan } from "../../shared/constants";
import { PLAN_IDS } from "../../constants/payment.constants";

const RECENT_SCORES_LIMIT = 10;

export type InterviewAnalyticsInput = {
  overallScore: number;
  domain: string;
  interviewType: string;
  targetTechnology: string;
  skills: string[];
  interviewDate?: Timestamp;
};

const defaultUserAnalytics = (): UserAnalytics => ({
  completedInterviews: 0,
  averageScore: 0,
  highestScore: 0,
  lowestScore: 0,
  lastInterviewDate: Timestamp.fromMillis(0),
  radarSkills: [],
  recentScores: [],
  domainPerformance: [],
  interviewTypes: [],
  monthlyPerformance: [],
});

const normalizeUserFields = (
  fields: Partial<Omit<User, "isActive" | "createdAt" | "updatedAt">> & { name?: string }
): Record<string, unknown> => {
  const normalized = { ...fields } as Record<string, unknown>;

  if (fields.name && !fields.displayName) {
    normalized.displayName = fields.name;
  }

  return normalized;
};

export const upsertUser = async (
  uid: string,
  fields: Partial<Omit<User, "isActive" | "createdAt" | "updatedAt">> & { name?: string }
): Promise<User> => {
  const ref = db.collection(COLLECTIONS.USERS).doc(uid);
  const snapshot = await ref.get();
  const payload = normalizeUserFields(fields);

  if (!snapshot.exists) {
    await ref.set({
      ...payload,
      uid,
      role: "candidate",
      isActive: true,
      preferences: DEFAULT_USER_PREFERENCES,
      subscription: DEFAULT_USER_SUBSCRIPTION,
      stats: {
        totalInterviews: 0,
        completedInterviews: 0,
        averageScore: 0,
        bestScore: 0,
      },
      interview: defaultUserAnalytics(),
      resume: { analyses: [] },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    await ref.update({
      ...payload,
      lastLoginAt: FieldValue.serverTimestamp(),
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

export const getUserProfile = async (uid: string): Promise<User> => requireUserById(uid);

const isValidInterviewSettings = (
  settings: unknown
): settings is UserInterviewSettings => {
  if (!settings || typeof settings !== "object") return false;

  const value = settings as Record<string, unknown>;

  return (
    typeof value.domain === "string" &&
    value.domain.trim().length > 0 &&
    typeof value.category === "string" &&
    value.category.trim().length > 0 &&
    typeof value.specification === "string" &&
    value.specification.trim().length > 0 &&
    typeof value.targetRole === "string" &&
    value.targetRole.trim().length > 0 &&
    typeof value.difficultyLevel === "string" &&
    DIFFICULTY_LEVELS.includes(value.difficultyLevel as UserInterviewSettings["difficultyLevel"]) &&
    typeof value.interviewType === "string" &&
    value.interviewType.trim().length > 0 &&
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
    domain: typeof value.domain === "string" ? value.domain.trim() : undefined,
    category: typeof value.category === "string" ? value.category.trim() : undefined,
    specification:
      typeof value.specification === "string" ? value.specification.trim() : undefined,
    targetRole: typeof value.targetRole === "string" ? value.targetRole.trim() : undefined,
    difficultyLevel:
      typeof rawDifficulty === "string"
        ? (rawDifficulty as UserInterviewSettings["difficultyLevel"])
        : undefined,
    interviewType:
      typeof value.interviewType === "string" && value.interviewType.trim().length > 0
        ? value.interviewType.trim()
        : undefined,
    durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : undefined,
    questionCount: Number.isFinite(questionCount) ? questionCount : undefined,
    experienceLevel:
      typeof value.experienceLevel === "string" && value.experienceLevel.trim().length > 0
        ? value.experienceLevel.trim()
        : undefined,
  };

  return isValidInterviewSettings(normalized) ? normalized : null;
};

const DEFAULT_NOTIFICATION_PREFERENCES: UserNotificationPreferences = {
  feedbackReports: false,
  interviewReminders: false,
};

export const getUserInterviewSettings = async (uid: string): Promise<UserInterviewSettings> => {
  const user = await requireUserById(uid);
  const settings = normalizeInterviewSettings(user.preferences?.interview);

  if (!settings) {
    throw new AppError(
      400,
      "Interview settings are missing. Please set domain, category, specification, targetRole, difficulty, durationMinutes, interviewType, and questionCount in users.preferences.interview."
    );
  }

  return settings;
};

export const getUserNotificationPreferences = async (
  uid: string
): Promise<UserNotificationPreferences> => {
  const user = await requireUserById(uid);
  const prefs = user.preferences?.notifications;

  if (!prefs) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  return {
    feedbackReports: prefs.feedbackReports === true,
    interviewReminders: prefs.interviewReminders === true,
  };
};

const defaultUserStats = (): UserStats => ({
  totalInterviews: 0,
  completedInterviews: 0,
  averageScore: 0,
  bestScore: 0,
});

const roundScore = (value: number): number => Math.round(value * 100) / 100;

const toMonthKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const updateRollingAverage = (
  previousAverage: number,
  previousCount: number,
  nextScore: number
): number => {
  if (previousCount <= 0) {
    return roundScore(nextScore);
  }
  return roundScore((previousAverage * previousCount + nextScore) / (previousCount + 1));
};

const updateRadarSkills = (
  existing: RadarSkill[],
  skills: string[],
  score: number
): RadarSkill[] => {
  const next = [...existing];

  for (const rawSkill of skills) {
    const skill = rawSkill.trim();
    if (!skill) continue;

    const index = next.findIndex(
      (item) => item.skill.toLowerCase() === skill.toLowerCase()
    );
    if (index === -1) {
      next.push({ skill, averageScore: roundScore(score) });
      continue;
    }

    // Approximate prior sample count from domain performance isn't available per skill;
    // blend toward the latest score so the radar stays responsive.
    const current = next[index];
    next[index] = {
      skill: current.skill,
      averageScore: roundScore(current.averageScore * 0.7 + score * 0.3),
    };
  }

  return next;
};

const updateDomainPerformance = (
  existing: DomainPerformance[],
  domain: string,
  score: number
): DomainPerformance[] => {
  const next = [...existing];
  const index = next.findIndex((item) => item.domain.toLowerCase() === domain.toLowerCase());

  if (index === -1) {
    next.push({ domain, interviews: 1, averageScore: roundScore(score) });
    return next;
  }

  const current = next[index];
  next[index] = {
    domain: current.domain,
    interviews: current.interviews + 1,
    averageScore: updateRollingAverage(current.averageScore, current.interviews, score),
  };
  return next;
};

const updateInterviewTypeStats = (
  existing: InterviewTypeStat[],
  interviewType: string
): InterviewTypeStat[] => {
  const next = [...existing];
  const index = next.findIndex(
    (item) => item.interviewType.toLowerCase() === interviewType.toLowerCase()
  );

  if (index === -1) {
    next.push({ interviewType, total: 1 });
    return next;
  }

  next[index] = {
    interviewType: next[index].interviewType,
    total: next[index].total + 1,
  };
  return next;
};

const updateMonthlyPerformance = (
  existing: MonthlyPerformance[],
  month: string,
  score: number
): MonthlyPerformance[] => {
  const next = [...existing];
  const index = next.findIndex((item) => item.month === month);

  if (index === -1) {
    next.push({ month, interviews: 1, averageScore: roundScore(score) });
    return next.sort((a, b) => a.month.localeCompare(b.month));
  }

  const current = next[index];
  next[index] = {
    month: current.month,
    interviews: current.interviews + 1,
    averageScore: updateRollingAverage(current.averageScore, current.interviews, score),
  };
  return next;
};

const buildUpdatedAnalytics = (
  existing: UserAnalytics | undefined,
  input: InterviewAnalyticsInput
): UserAnalytics => {
  const current = existing ?? defaultUserAnalytics();
  const score = roundScore(input.overallScore);
  const interviewDate = input.interviewDate ?? Timestamp.now();
  const completedInterviews = (current.completedInterviews ?? 0) + 1;
  const averageScore = updateRollingAverage(
    current.averageScore ?? 0,
    current.completedInterviews ?? 0,
    score
  );
  const highestScore =
    current.completedInterviews > 0 ? Math.max(current.highestScore ?? 0, score) : score;
  const lowestScore =
    current.completedInterviews > 0 ? Math.min(current.lowestScore ?? score, score) : score;

  const recentEntry: RecentScore = {
    targetTechnology: input.targetTechnology,
    score,
    interviewDate,
  };
  const recentScores = [recentEntry, ...(current.recentScores ?? [])].slice(
    0,
    RECENT_SCORES_LIMIT
  );

  const month = toMonthKey(interviewDate.toDate());

  return {
    completedInterviews,
    averageScore,
    highestScore,
    lowestScore,
    lastInterviewDate: interviewDate,
    radarSkills: updateRadarSkills(current.radarSkills ?? [], input.skills, score),
    recentScores,
    domainPerformance: updateDomainPerformance(
      current.domainPerformance ?? [],
      input.domain,
      score
    ),
    interviewTypes: updateInterviewTypeStats(
      current.interviewTypes ?? [],
      input.interviewType
    ),
    monthlyPerformance: updateMonthlyPerformance(
      current.monthlyPerformance ?? [],
      month,
      score
    ),
  };
};

export const incrementTotalInterviews = async (uid: string): Promise<void> => {
  const ref = db.collection(COLLECTIONS.USERS).doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, "User account not found.");

    const user = snap.data() as User;
    const stats = user.stats ?? defaultUserStats();

    tx.update(ref, {
      stats: {
        ...stats,
        totalInterviews: (stats.totalInterviews ?? 0) + 1,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};

export const updateStatsOnInterviewFinish = async (
  uid: string,
  overallScore: number,
  analyticsInput?: Omit<InterviewAnalyticsInput, "overallScore">
): Promise<void> => {
  const ref = db.collection(COLLECTIONS.USERS).doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, "User account not found.");

    const user = snap.data() as User;
    const stats = user.stats ?? defaultUserStats();
    const prevCompleted = stats.completedInterviews ?? 0;
    const completedInterviews = prevCompleted + 1;
    const prevAverage = stats.averageScore ?? 0;
    const averageScore =
      prevCompleted === 0
        ? overallScore
        : (prevAverage * prevCompleted + overallScore) / completedInterviews;

    const interviewAnalytics = analyticsInput
      ? buildUpdatedAnalytics(user.interview, {
          overallScore,
          ...analyticsInput,
        })
      : buildUpdatedAnalytics(user.interview, {
          overallScore,
          domain: "General",
          interviewType: "technicalInterview",
          targetTechnology: "General",
          skills: [],
        });

    tx.update(ref, {
      stats: {
        totalInterviews: stats.totalInterviews ?? 0,
        completedInterviews,
        averageScore: roundScore(averageScore),
        bestScore: Math.max(stats.bestScore ?? 0, overallScore),
      },
      interview: interviewAnalytics,
      updatedAt: FieldValue.serverTimestamp(),
    });
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
    const analyses = user.resume?.analyses ?? [];
    const highestNo = analyses.reduce((maxNo, item) => Math.max(maxNo, item.no ?? 0), 0);
    const nextEntry: UserResumeAnalysisEntry = {
      no: highestNo + 1,
      ...entry,
    };

    tx.update(ref, {
      resume: {
        url: entry.url ?? user.resume?.url,
        analyses: [...analyses, nextEntry],
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    return nextEntry;
  });
};
