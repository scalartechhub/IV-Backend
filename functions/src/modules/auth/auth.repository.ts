import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../../config/firebase";
import { COLLECTIONS } from "../../shared/constants";
import { assertInterviewCreationAllowed, assertResumeAnalysisAllowed } from "../../shared/entitlements";
import { getStartOfCurrentMonth, resolveBillingPlan } from "../../shared/plan.utils";
import { AppError } from "../../shared/utils";
import type { Interview, ResumeAnalysis } from "../interview/interview.types";
import { getPlanMonthlyLimits } from "../payment/plan.repository";
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
import { DIFFICULTY_LEVELS, INTERVIEW_TYPES } from "../../shared/constants";
// When re-enabling plan-based difficulty limits, also import SubscriptionPlan:
// import { DIFFICULTY_LEVELS, INTERVIEW_TYPES, type SubscriptionPlan } from "../../shared/constants";
import { PLAN_IDS } from "../../constants/payment.constants";

const RECENT_SCORES_LIMIT = 10;

const toMonthKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

export type InterviewAnalyticsInput = {
  overallScore: number;
  domain: string;
  interviewType: string;
  targetTechnology: string;
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
  const now = Timestamp.now();
  const monthKey = toMonthKey(now.toDate());

  if (!snapshot.exists) {
    const created: User = {
      ...(payload as Omit<User, "isActive" | "createdAt" | "updatedAt" | "role" | "preferences" | "subscription" | "stats" | "interview" | "resume">),
      uid,
      displayName: String(payload.displayName ?? fields.name ?? ""),
      role: "candidate",
      isActive: true,
      preferences: DEFAULT_USER_PREFERENCES,
      subscription: DEFAULT_USER_SUBSCRIPTION,
      stats: {
        totalInterviews: 0,
        completedInterviews: 0,
        averageScore: 0,
        bestScore: 0,
        interviewsCreatedThisMonth: 0,
        interviewsMonthKey: monthKey,
        resumeAnalysesCreatedThisMonth: 0,
        resumeAnalysesMonthKey: monthKey,
      },
      interview: defaultUserAnalytics(),
      resume: { analyses: [] },
      createdAt: now,
      updatedAt: now,
    };

    await ref.set({
      ...created,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return created;
  }

  const existing = snapshot.data() as User;
  await ref.update({
    ...payload,
    lastLoginAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    ...existing,
    ...payload,
    displayName: String(payload.displayName ?? existing.displayName ?? ""),
    lastLoginAt: now,
    updatedAt: now,
  } as User;
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

// export const subscriptionPlanFromUser = (user: User): SubscriptionPlan => {
//   const billingPlan = resolveBillingPlan(user);
//
//   if (billingPlan === PLAN_IDS.ENTERPRISE || billingPlan === PLAN_IDS.PRO) {
//     return "pro";
//   }
//
//   return "starter";
// };
//
// export const getUserSubscriptionPlan = async (uid: string): Promise<SubscriptionPlan> => {
//   const user = await requireUserById(uid);
//   return subscriptionPlanFromUser(user);
// };

const readMonthlyCountFromUser = (user: User | null | undefined, monthKey: string): number | null => {
  if (
    user?.stats?.interviewsMonthKey === monthKey &&
    typeof user.stats.interviewsCreatedThisMonth === "number"
  ) {
    return Math.max(0, user.stats.interviewsCreatedThisMonth);
  }
  return null;
};

const isMissingIndexError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: number | string })?.code;
  return (
    message.includes("FAILED_PRECONDITION") ||
    message.includes("requires an index") ||
    code === 9 ||
    code === "failed-precondition"
  );
};

/**
 * Cheap aggregation count — uses the existing
 * (userId, isDeleted, createdAt DESC) composite index.
 */
const queryInterviewsCreatedThisMonthCount = async (uid: string): Promise<number> => {
  const startOfMonth = Timestamp.fromDate(getStartOfCurrentMonth());

  try {
    const snapshot = await db
      .collection(COLLECTIONS.INTERVIEWS)
      .where("userId", "==", uid)
      .where("isDeleted", "==", false)
      .where("createdAt", ">=", startOfMonth)
      .orderBy("createdAt", "desc")
      .count()
      .get();

    return snapshot.data().count;
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;

    // Fallback for environments where the composite index is not ready yet.
    // Uses the simpler (userId, isDeleted) index, then filters the month in memory once.
    const startMs = startOfMonth.toMillis();
    const snapshot = await db
      .collection(COLLECTIONS.INTERVIEWS)
      .where("userId", "==", uid)
      .where("isDeleted", "==", false)
      .get();

    return snapshot.docs.filter((doc) => {
      const interview = doc.data() as Interview;
      const createdAt = interview.createdAt;
      if (!createdAt) return false;

      const createdMs =
        typeof (createdAt as { toMillis?: () => number }).toMillis === "function"
          ? (createdAt as { toMillis: () => number }).toMillis()
          : new Date(createdAt as unknown as string).getTime();

      return createdMs >= startMs;
    }).length;
  }
};

const persistMonthlyInterviewCount = async (uid: string, count: number, monthKey: string): Promise<void> => {
  await db.collection(COLLECTIONS.USERS).doc(uid).update({
    "stats.interviewsCreatedThisMonth": count,
    "stats.interviewsMonthKey": monthKey,
    updatedAt: FieldValue.serverTimestamp(),
  });
};

/**
 * Monthly interview usage for entitlements / subscription UI.
 * Prefers the user-doc counter (0 interview reads); backfills via aggregation count once.
 */
export const countInterviewsCreatedThisMonth = async (
  uid: string,
  user?: User | null
): Promise<number> => {
  const monthKey = toMonthKey(new Date());
  const fromProvided = readMonthlyCountFromUser(user, monthKey);
  if (fromProvided !== null) return fromProvided;

  const resolved = user ?? (await findUserById(uid));
  const fromStored = readMonthlyCountFromUser(resolved, monthKey);
  if (fromStored !== null) return fromStored;

  const count = await queryInterviewsCreatedThisMonthCount(uid);
  if (resolved) {
    await persistMonthlyInterviewCount(uid, count, monthKey);
  }

  return count;
};

export const assertUserCanCreateInterview = async (
  uid: string,
  user?: User
): Promise<void> => {
  const resolved = user ?? (await requireUserById(uid));
  const billingPlan = resolveBillingPlan(resolved);
  const usedThisMonth = await countInterviewsCreatedThisMonth(uid, resolved);
  const { monthlyInterviewLimit } = await getPlanMonthlyLimits(billingPlan);

  assertInterviewCreationAllowed(billingPlan, usedThisMonth, monthlyInterviewLimit);
};

const readMonthlyResumeCountFromUser = (
  user: User | null | undefined,
  monthKey: string
): number | null => {
  if (
    user?.stats?.resumeAnalysesMonthKey === monthKey &&
    typeof user.stats.resumeAnalysesCreatedThisMonth === "number"
  ) {
    return Math.max(0, user.stats.resumeAnalysesCreatedThisMonth);
  }
  return null;
};

const timestampToMillis = (value: unknown): number | null => {
  if (!value) return null;
  if (typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  const parsed = new Date(value as string).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const countResumeAnalysesFromUserDoc = (user: User): number => {
  const startMs = getStartOfCurrentMonth().getTime();
  const analyses = user.resume?.analyses ?? [];
  return analyses.filter((entry) => {
    const uploadedMs = timestampToMillis(entry.uploadedAt);
    return uploadedMs !== null && uploadedMs >= startMs;
  }).length;
};

/**
 * Monthly resume analysis usage for entitlements / subscription UI.
 * Prefers the user-doc counter; backfills by counting analyses on the user doc.
 */
export const countResumeAnalysesThisMonth = async (
  uid: string,
  user?: User | null
): Promise<number> => {
  const monthKey = toMonthKey(new Date());
  const fromProvided = readMonthlyResumeCountFromUser(user, monthKey);
  if (fromProvided !== null) return fromProvided;

  const resolved = user ?? (await findUserById(uid));
  const fromStored = readMonthlyResumeCountFromUser(resolved, monthKey);
  if (fromStored !== null) return fromStored;

  if (!resolved) return 0;

  const count = countResumeAnalysesFromUserDoc(resolved);
  await db.collection(COLLECTIONS.USERS).doc(uid).update({
    "stats.resumeAnalysesCreatedThisMonth": count,
    "stats.resumeAnalysesMonthKey": monthKey,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return count;
};

export const assertUserCanAnalyzeResume = async (
  uid: string,
  user?: User
): Promise<void> => {
  const resolved = user ?? (await requireUserById(uid));
  const billingPlan = resolveBillingPlan(resolved);
  const usedThisMonth = await countResumeAnalysesThisMonth(uid, resolved);
  const { monthlyResumeAnalysisLimit } = await getPlanMonthlyLimits(billingPlan);

  assertResumeAnalysisAllowed(billingPlan, usedThisMonth, monthlyResumeAnalysisLimit);
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

export const interviewSettingsFromUser = (user: User): UserInterviewSettings => {
  const settings = normalizeInterviewSettings(user.preferences?.interview);

  if (!settings) {
    throw new AppError(
      400,
      "Interview settings are missing. Please set domain, category, specification, targetRole, difficulty, durationMinutes, interviewType, and questionCount in users.preferences.interview."
    );
  }

  return settings;
};

export const getUserInterviewSettings = async (uid: string): Promise<UserInterviewSettings> => {
  const user = await requireUserById(uid);
  return interviewSettingsFromUser(user);
};

export const notificationPreferencesFromUser = (
  user: User
): UserNotificationPreferences => {
  const prefs = user.preferences?.notifications;

  if (!prefs) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  return {
    feedbackReports: prefs.feedbackReports === true,
    interviewReminders: prefs.interviewReminders === true,
  };
};

export const getUserNotificationPreferences = async (
  uid: string
): Promise<UserNotificationPreferences> => {
  const user = await requireUserById(uid);
  return notificationPreferencesFromUser(user);
};

const defaultUserStats = (): UserStats => ({
  totalInterviews: 0,
  completedInterviews: 0,
  averageScore: 0,
  bestScore: 0,
  interviewsCreatedThisMonth: 0,
  interviewsMonthKey: toMonthKey(new Date()),
  resumeAnalysesCreatedThisMonth: 0,
  resumeAnalysesMonthKey: toMonthKey(new Date()),
});

const roundScore = (value: number): number => Math.round(value * 100) / 100;
type UserExperienceEntry = NonNullable<NonNullable<User["profile"]>["experiences"]>[number];
type UserSkillItem = NonNullable<NonNullable<User["profile"]>["skills"]>[number];
type InterviewDomainRoleRecord = { name: string; roles: string[] };
type InterviewDomainCategoryRecord = { name: string; specializations: InterviewDomainRoleRecord[] };
type InterviewDomainRecord = {
  domainName: string;
  interviewTypes: string[];
  categories: InterviewDomainCategoryRecord[];
};
type CareerPathMatch = {
  domain: string;
  category: string;
  specification: string;
  targetRole: string;
  interviewType?: string;
};

const INTERVIEW_DOMAIN_COLLECTION = "interview_domain";

const omitUndefinedDeep = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .map((item) => omitUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }

  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(source)) {
      if (item === undefined) continue;
      output[key] = omitUndefinedDeep(item);
    }

    return output as T;
  }

  return value;
};

const normalizeText = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeKey = (value: unknown): string =>
  normalizeText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "";

const similarityScore = (left: unknown, right: unknown): number => {
  const a = normalizeKey(left);
  const b = normalizeKey(right);
  if (!a || !b) return 0;
  if (a === b) return 3;
  if (a.includes(b) || b.includes(a)) return 2;

  const aWords = a.split(" ");
  const bWords = new Set(b.split(" "));
  const overlap = aWords.filter((word) => bWords.has(word)).length;
  return overlap > 0 ? 1 : 0;
};

const textContains = (source: string, target: unknown): boolean => {
  const token = normalizeKey(target);
  return token.length > 0 && source.includes(token);
};

const findDomainRecord = (
  domains: InterviewDomainRecord[],
  domainName: unknown
): InterviewDomainRecord | undefined => {
  const key = normalizeKey(domainName);
  if (!key) return undefined;
  return domains.find((domain) => normalizeKey(domain.domainName) === key);
};

const findCategoryRecord = (
  domain: InterviewDomainRecord | undefined,
  categoryName: unknown
): InterviewDomainCategoryRecord | undefined => {
  const key = normalizeKey(categoryName);
  if (!domain || !key) return undefined;
  return domain.categories.find((category) => normalizeKey(category.name) === key);
};

const findSpecializationRecord = (
  category: InterviewDomainCategoryRecord | undefined,
  specificationName: unknown
): InterviewDomainRoleRecord | undefined => {
  const key = normalizeKey(specificationName);
  if (!category || !key) return undefined;
  return category.specializations.find((specialization) => normalizeKey(specialization.name) === key);
};

const isValidCareerPathInDomains = (
  domains: InterviewDomainRecord[],
  selection: { domain?: unknown; category?: unknown; specification?: unknown; targetRole?: unknown }
): boolean => {
  const domain = findDomainRecord(domains, selection.domain);
  if (!domain) return false;
  const category = findCategoryRecord(domain, selection.category);
  if (!category) return false;
  const specialization = findSpecializationRecord(category, selection.specification);
  if (!specialization) return false;

  const roleKey = normalizeKey(selection.targetRole);
  if (!roleKey) return false;
  return specialization.roles.some((role) => normalizeKey(role) === roleKey);
};

const normalizeInterviewDomainsFromPayload = (raw: unknown): InterviewDomainRecord[] => {
  const payload = raw as Record<string, unknown> | undefined;
  const domainsRaw = Array.isArray(payload?.domains) ? payload.domains : [];

  return domainsRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const domain = item as Record<string, unknown>;
      const domainName = normalizeText(domain.domainName);
      if (!domainName) return null;

      const interviewTypes = Array.isArray(domain.interviewTypes)
        ? domain.interviewTypes.map((type) => normalizeText(type)).filter((type): type is string => Boolean(type))
        : [];
      const categoriesRaw = Array.isArray(domain.categories) ? domain.categories : [];
      const categories: InterviewDomainCategoryRecord[] = categoriesRaw
        .map((categoryItem) => {
          if (!categoryItem || typeof categoryItem !== "object") return null;
          const categoryRecord = categoryItem as Record<string, unknown>;
          const categoryName = normalizeText(categoryRecord.name);
          if (!categoryName) return null;

          const specializationsRaw = Array.isArray(categoryRecord.specializations)
            ? categoryRecord.specializations
            : [];
          const specializations: InterviewDomainRoleRecord[] = specializationsRaw
            .map((specItem) => {
              if (!specItem || typeof specItem !== "object") return null;
              const specRecord = specItem as Record<string, unknown>;
              const specName = normalizeText(specRecord.name);
              if (!specName) return null;
              const roles = Array.isArray(specRecord.roles)
                ? specRecord.roles
                    .map((role) => normalizeText(role))
                    .filter((role): role is string => Boolean(role))
                : [];
              return { name: specName, roles };
            })
            .filter((spec): spec is InterviewDomainRoleRecord => Boolean(spec));

          return { name: categoryName, specializations };
        })
        .filter((category): category is InterviewDomainCategoryRecord => Boolean(category));

      return {
        domainName,
        interviewTypes,
        categories,
      };
    })
    .filter((domain): domain is InterviewDomainRecord => Boolean(domain));
};

const resolveCareerPathMatch = (
  domains: InterviewDomainRecord[],
  analysis: ResumeAnalysis
): CareerPathMatch | null => {
  if (domains.length === 0) return null;

  const resumeSignal = normalizeKey(
    [
      analysis.targetRole,
      analysis.domain,
      analysis.category,
      analysis.specification,
      analysis.projects.join(" "),
      analysis.experience.join(" "),
      analysis.skills.join(" "),
    ].join(" ")
  );

  let best:
    | (CareerPathMatch & {
        score: number;
      })
    | null = null;

  for (const domain of domains) {
    for (const category of domain.categories) {
      for (const specialization of category.specializations) {
        const roles = specialization.roles.length > 0 ? specialization.roles : [specialization.name];
        for (const role of roles) {
          let score = 0;
          score += similarityScore(role, analysis.targetRole) * 8;
          score += similarityScore(specialization.name, analysis.specification) * 6;
          score += similarityScore(category.name, analysis.category) * 4;
          score += similarityScore(domain.domainName, analysis.domain) * 3;

          if (textContains(resumeSignal, role)) score += 3;
          if (textContains(resumeSignal, specialization.name)) score += 2;
          if (textContains(resumeSignal, category.name)) score += 1;
          if (textContains(resumeSignal, domain.domainName)) score += 1;

          if (!best || score > best.score) {
            best = {
              domain: domain.domainName,
              category: category.name,
              specification: specialization.name,
              targetRole: role,
              interviewType: domain.interviewTypes[0],
              score,
            };
          }
        }
      }
    }
  }

  if (!best || best.score <= 0) return null;

  return {
    domain: best.domain,
    category: best.category,
    specification: best.specification,
    targetRole: best.targetRole,
    interviewType: best.interviewType,
  };
};

const preferExistingText = (existing: unknown, incoming: unknown): string | undefined =>
  normalizeText(existing) ?? normalizeText(incoming);

const parseLocation = (
  rawLocation: unknown
): { city?: string; state?: string; country?: string } | undefined => {
  const location = normalizeText(rawLocation);
  if (!location) return undefined;

  const parts = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return undefined;
  if (parts.length === 1) return { city: parts[0] };
  if (parts.length === 2) return { city: parts[0], country: parts[1] };

  return {
    city: parts[0],
    state: parts.slice(1, parts.length - 1).join(", "),
    country: parts[parts.length - 1],
  };
};

const extractYearsFromText = (input: string): number | null => {
  const match = input.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
};

const inferYearsOfExperience = (analysis: ResumeAnalysis): string | undefined => {
  const explicit = normalizeText(analysis.yearsOfExperience);
  if (explicit) return explicit;

  const values = analysis.experience
    .map((item) => extractYearsFromText(item))
    .filter((value): value is number => value !== null);
  if (values.length === 0) return undefined;

  const maxYears = Math.max(...values);
  return `${maxYears}+ years`;
};

const inferDifficultyLevel = (
  explicit: unknown,
  yearsOfExperience: string | undefined
): UserInterviewSettings["difficultyLevel"] => {
  const provided = normalizeText(explicit);
  if (provided && DIFFICULTY_LEVELS.includes(provided as UserInterviewSettings["difficultyLevel"])) {
    return provided as UserInterviewSettings["difficultyLevel"];
  }

  const years = yearsOfExperience ? extractYearsFromText(yearsOfExperience) ?? 0 : 0;
  if (years >= 8) return "expert";
  if (years >= 5) return "hard";
  if (years >= 2) return "medium";
  return "easy";
};

const parseResumeExperienceEntry = (
  raw: string
): { title: string; company: string; period?: string; description?: string } => {
  const normalized = raw.trim();
  const pattern = /^(.+?)\s+at\s+([^(:]+?)(?:\s*\(([^)]+)\))?(?::\s*(.+))?$/i;
  const match = normalized.match(pattern);

  if (match) {
    const title = normalizeText(match[1]) ?? "Professional Experience";
    const company = normalizeText(match[2]) ?? "Not specified";
    const period = normalizeText(match[3]);
    const description = normalizeText(match[4]) ?? normalized;
    return { title, company, period, description };
  }

  const [headline, ...rest] = normalized.split(":");
  const description = normalizeText(rest.join(":"));
  return {
    title: normalizeText(headline) ?? "Professional Experience",
    company: "Not specified",
    description: description ?? normalized,
  };
};

const buildExperienceEntries = (
  existing: User["profile"],
  analysis: ResumeAnalysis
): UserExperienceEntry[] => {
  const existingEntries = existing?.experiences ?? [];
  const maxId = existingEntries.reduce((max, entry) => Math.max(max, entry.id ?? 0), 0);
  const parsed = analysis.experience
    .map((item) => parseResumeExperienceEntry(item))
    .filter((item) => item.title.length > 0)
    .map((item, index) => ({
      id: maxId + index + 1,
      ...item,
    }));

  const seen = new Set(
    existingEntries.map((entry) =>
      `${entry.title.toLowerCase()}|${entry.company.toLowerCase()}|${(entry.period ?? "").toLowerCase()}`
    )
  );

  const dedupedParsed = parsed.filter((entry) => {
    const key = `${entry.title.toLowerCase()}|${entry.company.toLowerCase()}|${(entry.period ?? "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return [...existingEntries, ...dedupedParsed];
};

const buildSkillItems = (
  existing: User["profile"],
  analysis: ResumeAnalysis
): UserSkillItem[] => {
  const existingSkills = existing?.skills ?? [];
  const seen = new Set(existingSkills.map((item) => item.name.trim().toLowerCase()).filter(Boolean));
  const parsedSkills = analysis.skills
    .map((skill) => skill.trim())
    .filter(Boolean)
    .filter((skill) => {
      const key = skill.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((name) => ({ name }));

  return [...existingSkills, ...parsedSkills];
};

const buildProfileFromResumeAnalysis = (user: User, analysis: ResumeAnalysis): User["profile"] => {
  const existing = user.profile ?? {};
  const experienceEntries = buildExperienceEntries(existing, analysis);
  const firstExperience = experienceEntries[0];
  const inferredYears = inferYearsOfExperience(analysis);
  const parsedLocation = parseLocation(analysis.location);
  const mergedLocation = {
    ...(existing.location ?? {}),
    ...(parsedLocation ?? {}),
  };

  return {
    ...existing,
    phone: preferExistingText(existing.phone, analysis.phone),
    designation: preferExistingText(existing.designation, analysis.targetRole ?? firstExperience?.title),
    company: preferExistingText(existing.company, firstExperience?.company),
    industry: preferExistingText(existing.industry, analysis.domain),
    yearsOfExperience: preferExistingText(existing.yearsOfExperience, inferredYears),
    bio: preferExistingText(existing.bio, analysis.projects[0]),
    location:
      Object.values(mergedLocation).some((value) => normalizeText(value))
        ? mergedLocation
        : existing.location,
    skills: buildSkillItems(existing, analysis),
    experiences: experienceEntries,
  };
};

const buildInterviewPreferencesFromResumeAnalysis = (
  user: User,
  analysis: ResumeAnalysis,
  domains: InterviewDomainRecord[],
  matchedCareerPath?: CareerPathMatch | null
): UserInterviewSettings => {
  const existingPrefs = user.preferences?.interview ?? ({} as Partial<UserInterviewSettings>);
  const inferredYears = inferYearsOfExperience(analysis);
  const hasValidExistingCareerPath = isValidCareerPathInDomains(domains, {
    domain: existingPrefs.domain,
    category: existingPrefs.category,
    specification: existingPrefs.specification,
    targetRole: existingPrefs.targetRole,
  });
  const selectedDomainName =
    (hasValidExistingCareerPath ? normalizeText(existingPrefs.domain) : undefined) ??
    normalizeText(matchedCareerPath?.domain) ??
    normalizeText(analysis.domain) ??
    "";
  const selectedDomain = findDomainRecord(domains, selectedDomainName);
  const targetRole =
    (hasValidExistingCareerPath ? normalizeText(existingPrefs.targetRole) : undefined) ??
    normalizeText(matchedCareerPath?.targetRole) ??
    normalizeText(analysis.targetRole) ??
    "";
  const rawInterviewType =
    normalizeText(existingPrefs.interviewType) ??
    normalizeText(analysis.interviewType) ??
    normalizeText(matchedCareerPath?.interviewType) ??
    "technicalInterview";
  const interviewType = INTERVIEW_TYPES.includes(rawInterviewType as (typeof INTERVIEW_TYPES)[number])
    ? rawInterviewType
    : "technicalInterview";
  const normalizedDomainInterviewTypes = (selectedDomain?.interviewTypes ?? []).map((type) =>
    normalizeKey(type)
  );
  const resolvedInterviewType =
    normalizedDomainInterviewTypes.length > 0 &&
    !normalizedDomainInterviewTypes.includes(normalizeKey(interviewType))
      ? selectedDomain?.interviewTypes?.[0] ?? interviewType
      : interviewType;

  const techStacks =
    existingPrefs.techStacks && existingPrefs.techStacks.length > 0
      ? existingPrefs.techStacks
      : analysis.skills
          .map((skill) => skill.trim())
          .filter(Boolean)
          .slice(0, 10)
          .map((label) => ({ label }));

  return {
    domain:
      (hasValidExistingCareerPath ? normalizeText(existingPrefs.domain) : undefined) ??
      normalizeText(matchedCareerPath?.domain) ??
      normalizeText(analysis.domain) ??
      "",
    category:
      (hasValidExistingCareerPath ? normalizeText(existingPrefs.category) : undefined) ??
      normalizeText(matchedCareerPath?.category) ??
      normalizeText(analysis.category) ??
      "",
    specification:
      (hasValidExistingCareerPath ? normalizeText(existingPrefs.specification) : undefined) ??
      normalizeText(matchedCareerPath?.specification) ??
      normalizeText(analysis.specification) ??
      "",
    targetRole,
    difficultyLevel: inferDifficultyLevel(
      existingPrefs.difficultyLevel ?? analysis.difficultyLevel,
      inferredYears
    ),
    interviewType: resolvedInterviewType,
    durationMinutes:
      typeof existingPrefs.durationMinutes === "number" && existingPrefs.durationMinutes > 0
        ? existingPrefs.durationMinutes
        : 30,
    questionCount:
      typeof existingPrefs.questionCount === "number" && existingPrefs.questionCount > 0
        ? existingPrefs.questionCount
        : 10,
    experienceLevel: preferExistingText(existingPrefs.experienceLevel, inferredYears),
    aiPersonality: existingPrefs.aiPersonality,
    techStacks,
  };
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

/** Radar chart points: one entry per domain with that domain's average score. */
const toRadarSkillsFromDomains = (domains: DomainPerformance[]): RadarSkill[] =>
  domains.map((item) => ({
    skill: item.domain,
    averageScore: item.averageScore,
  }));

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
  const domainPerformance = updateDomainPerformance(
    current.domainPerformance ?? [],
    input.domain,
    score
  );

  return {
    completedInterviews,
    averageScore,
    highestScore,
    lowestScore,
    lastInterviewDate: interviewDate,
    radarSkills: toRadarSkillsFromDomains(domainPerformance),
    recentScores,
    domainPerformance,
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
  const monthKey = toMonthKey(new Date());

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, "User account not found.");

    const user = snap.data() as User;
    const stats = user.stats ?? defaultUserStats();
    const monthlyUsed =
      stats.interviewsMonthKey === monthKey ? (stats.interviewsCreatedThisMonth ?? 0) : 0;

    tx.update(ref, {
      stats: {
        ...stats,
        totalInterviews: (stats.totalInterviews ?? 0) + 1,
        interviewsCreatedThisMonth: monthlyUsed + 1,
        interviewsMonthKey: monthKey,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};

/** Keeps monthly quota in sync when a non-deleted interview is soft-deleted. */
export const decrementMonthlyInterviewCountIfNeeded = async (
  uid: string,
  interviewCreatedAt: Timestamp | undefined
): Promise<void> => {
  if (!interviewCreatedAt) return;

  const createdDate = interviewCreatedAt.toDate();
  const interviewMonthKey = toMonthKey(createdDate);
  const currentMonthKey = toMonthKey(new Date());
  if (interviewMonthKey !== currentMonthKey) return;

  const ref = db.collection(COLLECTIONS.USERS).doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;

    const user = snap.data() as User;
    const stats = user.stats ?? defaultUserStats();
    if (stats.interviewsMonthKey !== currentMonthKey) return;

    const next = Math.max(0, (stats.interviewsCreatedThisMonth ?? 0) - 1);
    tx.update(ref, {
      stats: {
        ...stats,
        interviewsCreatedThisMonth: next,
        interviewsMonthKey: currentMonthKey,
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
  const interviewDomainRef = db
    .collection(INTERVIEW_DOMAIN_COLLECTION)
    .doc(INTERVIEW_DOMAIN_COLLECTION);
  const monthKey = toMonthKey(new Date());

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, "User account not found.");

    const user = snap.data() as User;
    const analyses = user.resume?.analyses ?? [];
    const highestNo = analyses.reduce((maxNo, item) => Math.max(maxNo, item.no ?? 0), 0);
    const sanitizedParsed = omitUndefinedDeep(entry.parsed);
    const nextEntry: UserResumeAnalysisEntry = {
      no: highestNo + 1,
      ...entry,
      parsed: sanitizedParsed,
    };

    const stats = user.stats ?? defaultUserStats();
    const monthlyUsed =
      stats.resumeAnalysesMonthKey === monthKey
        ? (stats.resumeAnalysesCreatedThisMonth ?? 0)
        : 0;
    const interviewDomainSnap = await tx.get(interviewDomainRef);
    const interviewDomains = normalizeInterviewDomainsFromPayload(interviewDomainSnap.data());
    const matchedCareerPath = resolveCareerPathMatch(interviewDomains, entry.parsed);
    const profile = buildProfileFromResumeAnalysis(user, entry.parsed);
    const interviewPreferences = buildInterviewPreferencesFromResumeAnalysis(
      user,
      entry.parsed,
      interviewDomains,
      matchedCareerPath
    );
    const existingPreferences = omitUndefinedDeep((user.preferences ?? {}) as Record<string, unknown>);

    tx.update(ref, {
      resume: {
        url: entry.url ?? user.resume?.url,
        analyses: [...analyses, omitUndefinedDeep(nextEntry)],
      },
      profile: omitUndefinedDeep(profile),
      preferences: {
        ...existingPreferences,
        interview: omitUndefinedDeep(interviewPreferences),
        notifications:
          user.preferences?.notifications ?? DEFAULT_USER_PREFERENCES.notifications,
      },
      stats: {
        ...stats,
        resumeAnalysesCreatedThisMonth: monthlyUsed + 1,
        resumeAnalysesMonthKey: monthKey,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    return nextEntry;
  });
};
