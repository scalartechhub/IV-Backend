import { db } from "../../config/firebase";
import {
  PLAN_IDS,
  PLAN_MONTHLY_INTERVIEW_LIMITS,
  PLAN_MONTHLY_RESUME_ANALYSIS_LIMITS,
  type BillingPlanId,
} from "../../constants/payment.constants";
import { COLLECTIONS } from "../../shared/constants";
import type { Plan } from "./payment.model";

export interface PlanMonthlyLimits {
  monthlyInterviewLimit: number | null;
  monthlyResumeAnalysisLimit: number | null;
}

const getPlansCollection = () => db.collection(COLLECTIONS.PLANS);

/** `null` / missing / negative = unlimited (same convention as interviewCredits). */
export const normalizeMonthlyLimit = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
};

export const getPlanById = async (planId: string): Promise<Plan | null> => {
  const snap = await getPlansCollection().doc(planId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() } as Plan;
};

/**
 * Reads monthly quotas from `plans/{planId}`.
 * Falls back to code defaults only when the plan doc / fields are missing.
 */
export const getPlanMonthlyLimits = async (
  planId: BillingPlanId
): Promise<PlanMonthlyLimits> => {
  const fallback: PlanMonthlyLimits = {
    monthlyInterviewLimit: PLAN_MONTHLY_INTERVIEW_LIMITS[planId] ?? null,
    monthlyResumeAnalysisLimit: PLAN_MONTHLY_RESUME_ANALYSIS_LIMITS[planId] ?? null,
  };

  const plan = await getPlanById(planId);
  if (!plan) return fallback;

  const interviewFromPlan =
    plan.monthlyInterviewLimit !== undefined
      ? normalizeMonthlyLimit(plan.monthlyInterviewLimit)
      : undefined;
  const resumeFromPlan =
    plan.monthlyResumeAnalysisLimit !== undefined
      ? normalizeMonthlyLimit(plan.monthlyResumeAnalysisLimit)
      : undefined;

  return {
    monthlyInterviewLimit:
      interviewFromPlan !== undefined ? interviewFromPlan : fallback.monthlyInterviewLimit,
    monthlyResumeAnalysisLimit:
      resumeFromPlan !== undefined ? resumeFromPlan : fallback.monthlyResumeAnalysisLimit,
  };
};

export const getFreePlanMonthlyLimits = (): Promise<PlanMonthlyLimits> =>
  getPlanMonthlyLimits(PLAN_IDS.FREE);
