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
  // New model: subscriptionSummary
  const summary = userData?.subscriptionSummary as SubscriptionSummary | undefined;
  if (summary && summary.status === SUBSCRIPTION_STATUS.ACTIVE) {
    const tier = BILLING_PLAN_TO_TIER[summary.planId as BillingPlanIdWithCycle];
    if (tier) return tier;
    // Direct tier match (e.g. "pro", "elite")
    if (summary.planId === PLAN_IDS.PRO || summary.planId === PLAN_IDS.ELITE) {
      return summary.planId as BillingPlanId;
    }
  }

  // Legacy model: subscription.plan
  const legacyPlan = userData?.subscription?.plan?.toLowerCase?.()?.trim?.();
  const legacyStatus = userData?.subscription?.status;

  if (legacyPlan && legacyStatus === SUBSCRIPTION_STATUS.ACTIVE) {
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

const currentMonthKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const getUsageCounters = (userData: Record<string, any>): UsageCounters => {
  const stats = userData?.stats || {};
  const key = currentMonthKey();

  return {
    interviewsCreatedThisMonth:
      stats.interviewsMonthKey === key ? (stats.interviewsCreatedThisMonth ?? 0) : 0,
    interviewsMonthKey: key,
    resumeAnalysesCreatedThisMonth:
      stats.resumeAnalysesMonthKey === key ? (stats.resumeAnalysesCreatedThisMonth ?? 0) : 0,
    resumeAnalysesMonthKey: key,
  };
};

/**
 * Asserts user has not exhausted their monthly interview quota.
 * Throws 403 with USAGE_LIMIT_REACHED if limit reached.
 */
export const assertInterviewQuota = async (uid: string): Promise<void> => {
  const userDoc = await usersCol().doc(uid).get();
  const userData = userDoc.data() || {};
  const tier = resolveEffectivePlanTier(userData);
  const usage = getUsageCounters(userData);

  const limits = await getPlanMonthlyLimits(tier);
  const limit = limits.monthlyInterviewLimit;

  if (limit !== null && usage.interviewsCreatedThisMonth >= limit) {
    const upgradeHint =
      tier === PLAN_IDS.FREE
        ? " Upgrade to Pro for unlimited interviews."
        : tier === PLAN_IDS.PRO
        ? " Upgrade to Elite for more features."
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
  const usage = getUsageCounters(userData);

  const limits = await getPlanMonthlyLimits(tier);
  const limit = limits.monthlyResumeAnalysisLimit;

  if (limit !== null && usage.resumeAnalysesCreatedThisMonth >= limit) {
    throw new AppError(403, `You have reached your monthly limit of ${limit} resume analyses. Please upgrade your plan.`, [
      { field: "usage", message: "USAGE_LIMIT_REACHED" },
    ]);
  }
};

/**
 * Atomically increments the interview usage counter for the current month.
 */
export const recordInterviewUsage = async (uid: string): Promise<void> => {
  const key = currentMonthKey();
  const ref = usersCol().doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const stats = snap.data()?.stats || {};

    const isCurrentMonth = stats.interviewsMonthKey === key;

    tx.set(
      ref,
      {
        stats: {
          interviewsCreatedThisMonth: isCurrentMonth
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
 * Atomically increments the resume analysis usage counter for the current month.
 */
export const recordResumeAnalysisUsage = async (uid: string): Promise<void> => {
  const key = currentMonthKey();
  const ref = usersCol().doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const stats = snap.data()?.stats || {};

    const isCurrentMonth = stats.resumeAnalysesMonthKey === key;

    tx.set(
      ref,
      {
        stats: {
          resumeAnalysesCreatedThisMonth: isCurrentMonth
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
 */
export const getUsageSummary = async (uid: string): Promise<{
  planTier: string;
  interviewsUsed: number;
  interviewsLimit: number | null;
  resumeAnalysesUsed: number;
  resumeAnalysesLimit: number | null;
  periodStart: string;
  periodEnd: string;
}> => {
  const userDoc = await usersCol().doc(uid).get();
  const userData = userDoc.data() || {};
  const tier = resolveEffectivePlanTier(userData);
  const usage = getUsageCounters(userData);
  const limits = await getPlanMonthlyLimits(tier);

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

  return {
    planTier: tier,
    interviewsUsed: usage.interviewsCreatedThisMonth,
    interviewsLimit: limits.monthlyInterviewLimit,
    resumeAnalysesUsed: usage.resumeAnalysesCreatedThisMonth,
    resumeAnalysesLimit: limits.monthlyResumeAnalysisLimit,
    periodStart,
    periodEnd,
  };
};
