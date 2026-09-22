/**
 * Centralized feature access & usage tracking service.
 * Single source of truth for plan feature gating and monthly quota enforcement.
 */

import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase";
import {
  PLAN_IDS,
  PLAN_FEATURES,
  PLAN_MONTHLY_INTERVIEW_LIMITS,
  PLAN_MONTHLY_RESUME_ANALYSIS_LIMITS,
  SUBSCRIPTION_STATUS,
  BILLING_PLAN_TO_TIER,
  type BillingPlanId,
  type BillingPlanIdWithCycle,
  type PlanFeatureKey,
} from "../../constants/payment.constants";

import { COLLECTIONS } from "../../shared/constants";
import { AppError } from "../../shared/utils";
import { logger } from "../../shared/logger";
import type { SubscriptionSummary } from "../payment/payment.model";
import { getPlanMonthlyLimits } from "../payment/plan.repository";

const usersCol = () => db.collection(COLLECTIONS.USERS);

// ---------------------------------------------------------------------------
// RESOLVE PLAN TIER
// ---------------------------------------------------------------------------

/**
 * Resolves the effective billing plan tier from the user doc.
 * Checks both `subscriptionSummary` (new) and `subscription` (legacy).
 */
export const resolveEffectivePlanTier = (userData: Record<string, any>): BillingPlanId => {
  const nowMs = Date.now();

  // 1. New model: subscriptionSummary
  const summary = userData?.subscriptionSummary as SubscriptionSummary | undefined;
  if (summary && summary.status === SUBSCRIPTION_STATUS.ACTIVE) {
    // Check if period end has passed on paid plans
    const periodEndMs = summary.currentPeriodEnd ? new Date(summary.currentPeriodEnd).getTime() : null;
    if (
      periodEndMs !== null &&
      !isNaN(periodEndMs) &&
      periodEndMs < nowMs &&
      summary.planId !== PLAN_IDS.FREE &&
      summary.planId !== "free"
    ) {
      // Plan period has expired without renewal — fallback to Free
      return PLAN_IDS.FREE;
    }

    const tier = BILLING_PLAN_TO_TIER[summary.planId as BillingPlanIdWithCycle];
    if (tier) return tier;
    // Direct tier match (e.g. "pro", "elite")
    if (summary.planId === PLAN_IDS.PRO || summary.planId === PLAN_IDS.ELITE) {
      return summary.planId as BillingPlanId;
    }
  }

  // 2. Legacy model: subscription.plan
  const legacyPlan = userData?.subscription?.plan?.toLowerCase?.()?.trim?.();
  const legacyStatus = userData?.subscription?.status;
  const legacyExpiresAt = userData?.subscription?.expiresAt;
  const legacyExpiresMs = legacyExpiresAt ? new Date(legacyExpiresAt).getTime() : null;

  if (legacyPlan && (legacyStatus === SUBSCRIPTION_STATUS.ACTIVE || legacyStatus === "active")) {
    if (legacyExpiresMs !== null && !isNaN(legacyExpiresMs) && legacyExpiresMs < nowMs) {
      // Expired legacy plan
      return PLAN_IDS.FREE;
    }
    if (legacyPlan === PLAN_IDS.ENTERPRISE || legacyPlan === PLAN_IDS.ELITE) return PLAN_IDS.ELITE;
    if (legacyPlan === PLAN_IDS.PRO) return PLAN_IDS.PRO;
  }

  return PLAN_IDS.FREE;
};

// ---------------------------------------------------------------------------
// FEATURE ACCESS
// ---------------------------------------------------------------------------

/**
 * Asserts that the user's plan includes a specific feature.
 * Throws 403 if feature is not available.
 */
export const assertFeatureAccess = async (uid: string, feature: PlanFeatureKey): Promise<void> => {
  const userDoc = await usersCol().doc(uid).get();
  const tier = resolveEffectivePlanTier(userDoc.data() || {});
  const features = PLAN_FEATURES[tier as keyof typeof PLAN_FEATURES] || PLAN_FEATURES[PLAN_IDS.FREE];

  const featureValue = features[feature];

  if (featureValue === false) {
    throw new AppError(403, `This feature requires a paid plan. Please upgrade to access it.`, [
      { field: "feature", message: "FEATURE_NOT_AVAILABLE" },
    ]);
  }
};

// ---------------------------------------------------------------------------
// USAGE TRACKING
// ---------------------------------------------------------------------------

interface UsageCounters {
  interviewsCreatedThisMonth: number;
  interviewsMonthKey: string;
  resumeAnalysesCreatedThisMonth: number;
  resumeAnalysesMonthKey: string;
}

interface PeriodInfo {
  key: string;
  startDate: Date;
  startTimestamp: Timestamp;
  periodStartIso: string;
  periodEndIso: string;
}

/**
 * Resolves the active billing cycle period for a user.
 * - Free users: calendar month (e.g. Sep 1 - Sep 30, key: "2026-09").
 * - Paid subscribers (Pro/Elite): their exact subscription billing cycle
 *   (e.g. Sep 22 - Oct 22, key: "cycle_2026-09-22").
 */
const resolveUserPeriod = (userData: Record<string, any>, tier: BillingPlanId): PeriodInfo => {
  const summary = userData?.subscriptionSummary as SubscriptionSummary | undefined;
  const isPaid = tier !== PLAN_IDS.FREE && summary?.status === SUBSCRIPTION_STATUS.ACTIVE;

  const now = new Date();
  const calendarStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const calendarEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  if (isPaid && summary?.currentPeriodStart) {
    const startDate = new Date(summary.currentPeriodStart);
    const validStart = isNaN(startDate.getTime()) ? calendarStart : startDate;
    const key = `cycle_${validStart.toISOString().slice(0, 10)}`;
    return {
      key,
      startDate: validStart,
      startTimestamp: Timestamp.fromDate(validStart),
      periodStartIso: summary.currentPeriodStart,
      periodEndIso: summary.currentPeriodEnd || calendarEnd.toISOString(),
    };
  }

  // Free tier: standard calendar month
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return {
    key,
    startDate: calendarStart,
    startTimestamp: Timestamp.fromDate(calendarStart),
    periodStartIso: calendarStart.toISOString(),
    periodEndIso: calendarEnd.toISOString(),
  };
};

export const resolveUsageCounters = async (
  uid: string,
  userData: Record<string, any>
): Promise<UsageCounters> => {
  const stats = userData?.stats || {};
  const tier = resolveEffectivePlanTier(userData);
  const period = resolveUserPeriod(userData, tier);
  const key = period.key;

  const hasCurrentInterviewKey =
    stats.interviewsMonthKey === key &&
    typeof stats.interviewsCreatedThisMonth === "number";
  const hasCurrentResumeKey =
    stats.resumeAnalysesMonthKey === key &&
    typeof stats.resumeAnalysesCreatedThisMonth === "number";

  if (hasCurrentInterviewKey && hasCurrentResumeKey) {
    return {
      interviewsCreatedThisMonth: stats.interviewsCreatedThisMonth,
      interviewsMonthKey: key,
      resumeAnalysesCreatedThisMonth: stats.resumeAnalysesCreatedThisMonth,
      resumeAnalysesMonthKey: key,
    };
  }

  // Self-heal from actual Firestore records for this user's active cycle
  let interviewsCount = stats.interviewsMonthKey === key ? (stats.interviewsCreatedThisMonth ?? 0) : 0;
  let resumeCount = stats.resumeAnalysesMonthKey === key ? (stats.resumeAnalysesCreatedThisMonth ?? 0) : 0;

  // 1. Calculate actual interviews for current period if key is stale or missing
  if (!hasCurrentInterviewKey) {
    try {
      const snap = await db
        .collection(COLLECTIONS.INTERVIEWS)
        .where("userId", "==", uid)
        .where("createdAt", ">=", period.startTimestamp)
        .get();
      interviewsCount = snap.size;
    } catch (err) {
      logger.warn("[feature-access] Error querying monthly interviews for self-healing", {
        uid,
        error: err instanceof Error ? err.message : String(err),
      });
      interviewsCount = stats.interviewsMonthKey === key ? (stats.interviewsCreatedThisMonth ?? 0) : 0;
    }
  }

  // 2. Calculate actual resume analyses for current period if key is stale or missing
  if (!hasCurrentResumeKey) {
    try {
      let count = 0;
      const obDoc = await usersCol().doc(uid).collection("onboarding").doc("analysis").get();
      if (obDoc.exists) {
        const data = obDoc.data();
        let analyzedDate: Date | null = null;
        if (data?.lastAnalyzedAt?.toDate) analyzedDate = data.lastAnalyzedAt.toDate();
        else if (data?.uploadedAt?.toDate) analyzedDate = data.uploadedAt.toDate();
        else if (data?.lastAnalyzedAt) analyzedDate = new Date(data.lastAnalyzedAt);
        else if (data?.uploadedAt) analyzedDate = new Date(data.uploadedAt);

        if (analyzedDate && analyzedDate >= period.startDate) {
          count++;
        }
      }

      const resumesSnap = await usersCol()
        .doc(uid)
        .collection("resumes")
        .where("uploadedAt", ">=", period.startTimestamp)
        .get();
      count += resumesSnap.size;

      resumeCount = count;
    } catch (err) {
      logger.warn("[feature-access] Error querying monthly resumes for self-healing", {
        uid,
        error: err instanceof Error ? err.message : String(err),
      });
      resumeCount = stats.resumeAnalysesMonthKey === key ? (stats.resumeAnalysesCreatedThisMonth ?? 0) : 0;
    }
  }

  const result: UsageCounters = {
    interviewsCreatedThisMonth: interviewsCount,
    interviewsMonthKey: key,
    resumeAnalysesCreatedThisMonth: resumeCount,
    resumeAnalysesMonthKey: key,
  };

  // Asynchronously persist the self-healed counters back to users/{uid}.stats
  usersCol()
    .doc(uid)
    .set(
      {
        stats: {
          interviewsCreatedThisMonth: interviewsCount,
          interviewsMonthKey: key,
          resumeAnalysesCreatedThisMonth: resumeCount,
          resumeAnalysesMonthKey: key,
        },
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    )
    .catch((persistErr) => {
      logger.error("[feature-access] Failed to persist self-healed usage counters", {
        uid,
        error: persistErr instanceof Error ? persistErr.message : String(persistErr),
      });
    });

  return result;
};

/**
 * Asserts user has not exhausted their monthly interview quota.
 * Throws 403 with USAGE_LIMIT_REACHED if limit reached.
 */
export const assertInterviewQuota = async (uid: string): Promise<void> => {
  const userDoc = await usersCol().doc(uid).get();
  const userData = userDoc.data() || {};
  const tier = resolveEffectivePlanTier(userData);
  const usage = await resolveUsageCounters(uid, userData);

  const limits = await getPlanMonthlyLimits(tier);
  const limit = limits.monthlyInterviewLimit;

  if (limit !== null && usage.interviewsCreatedThisMonth >= limit) {
    const upgradeHint =
      tier === PLAN_IDS.FREE
        ? " Upgrade to Pro for 15 interviews per month or Elite for unlimited."
        : tier === PLAN_IDS.PRO
        ? " Upgrade to Elite for unlimited interviews."
        : "";

    throw new AppError(403, `You have reached your monthly limit of ${limit} interviews.${upgradeHint}`, [
      { field: "usage", message: "USAGE_LIMIT_REACHED" },
    ]);
  }
};

/**
 * Asserts user has not exhausted their monthly resume analysis quota.
 */
export const assertResumeAnalysisQuota = async (uid: string): Promise<void> => {
  const userDoc = await usersCol().doc(uid).get();
  const userData = userDoc.data() || {};
  const tier = resolveEffectivePlanTier(userData);
  const usage = await resolveUsageCounters(uid, userData);

  const limits = await getPlanMonthlyLimits(tier);
  const limit = limits.monthlyResumeAnalysisLimit;

  if (limit !== null && usage.resumeAnalysesCreatedThisMonth >= limit) {
    const upgradeHint =
      tier === PLAN_IDS.FREE
        ? " Upgrade to Pro for 3 resume analyses per month or Elite for unlimited."
        : tier === PLAN_IDS.PRO
        ? " Upgrade to Elite for unlimited resume analyses."
        : "";

    throw new AppError(403, `You have reached your monthly limit of ${limit} resume ${limit === 1 ? 'analysis' : 'analyses'}.${upgradeHint}`, [
      { field: "usage", message: "USAGE_LIMIT_REACHED" },
    ]);
  }
};

/**
 * Atomically increments the interview usage counter for the active cycle.
 */
export const recordInterviewUsage = async (uid: string): Promise<void> => {
  const ref = usersCol().doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const userData = snap.data() || {};
    const tier = resolveEffectivePlanTier(userData);
    const period = resolveUserPeriod(userData, tier);
    const key = period.key;

    const stats = userData.stats || {};
    const isCurrentPeriod = stats.interviewsMonthKey === key;

    tx.set(
      ref,
      {
        stats: {
          interviewsCreatedThisMonth: isCurrentPeriod
            ? FieldValue.increment(1)
            : 1,
          interviewsMonthKey: key,
        },
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
  });
};

/**
 * Atomically increments the resume analysis usage counter for the active cycle.
 */
export const recordResumeAnalysisUsage = async (uid: string): Promise<void> => {
  const ref = usersCol().doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const userData = snap.data() || {};
    const tier = resolveEffectivePlanTier(userData);
    const period = resolveUserPeriod(userData, tier);
    const key = period.key;

    const stats = userData.stats || {};
    const isCurrentPeriod = stats.resumeAnalysesMonthKey === key;

    tx.set(
      ref,
      {
        stats: {
          resumeAnalysesCreatedThisMonth: isCurrentPeriod
            ? FieldValue.increment(1)
            : 1,
          resumeAnalysesMonthKey: key,
        },
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
  });
};

/**
 * Returns the current usage summary for the user.
 * Field names match the frontend `SubscriptionUsageSummary` interface.
 */
export const getUsageSummary = async (uid: string): Promise<{
  planTier: string;
  interviewsThisMonth: number;
  interviewLimit: number | null;
  interviewsRemaining: number | null;
  resumeAnalysesThisMonth: number;
  resumeLimit: number | null;
  resumesRemaining: number | null;
  features: Record<string, boolean | string | number | null>;
  periodStart: string;
  periodEnd: string;
}> => {
  const userDoc = await usersCol().doc(uid).get();
  const userData = userDoc.data() || {};
  const tier = resolveEffectivePlanTier(userData);
  const usage = await resolveUsageCounters(uid, userData);
  const limits = await getPlanMonthlyLimits(tier);
  const period = resolveUserPeriod(userData, tier);

  const interviewsThisMonth = usage.interviewsCreatedThisMonth;
  const interviewLimit = limits.monthlyInterviewLimit;
  const resumeAnalysesThisMonth = usage.resumeAnalysesCreatedThisMonth;
  const resumeLimit = limits.monthlyResumeAnalysisLimit;

  // Pull feature map for the resolved tier; fall back to free
  const features: Record<string, boolean | string | number | null> =
    (PLAN_FEATURES as Record<string, unknown>)[tier] as Record<string, boolean | string | number | null> ||
    (PLAN_FEATURES[PLAN_IDS.FREE] as unknown as Record<string, boolean | string | number | null>);

  return {
    planTier: tier,
    interviewsThisMonth,
    interviewLimit,
    interviewsRemaining: interviewLimit === null ? null : Math.max(0, interviewLimit - interviewsThisMonth),
    resumeAnalysesThisMonth,
    resumeLimit,
    resumesRemaining: resumeLimit === null ? null : Math.max(0, resumeLimit - resumeAnalysesThisMonth),
    features,
    periodStart: period.periodStartIso,
    periodEnd: period.periodEndIso,
  };
};
