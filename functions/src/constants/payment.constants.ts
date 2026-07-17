export const SUBSCRIPTION_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  EXPIRED: "expired",
  FAILED: "failed",
} as const;

export const PLAN_IDS = {
  FREE: "free",
  PRO: "pro",
  ENTERPRISE: "enterprise",
} as const;

export type BillingPlanId = (typeof PLAN_IDS)[keyof typeof PLAN_IDS];

/** Fallback interview quotas if `plans/{id}.monthlyInterviewLimit` is missing. `null` = unlimited. */
export const PLAN_MONTHLY_INTERVIEW_LIMITS: Record<BillingPlanId, number | null> = {
  [PLAN_IDS.FREE]: 10,
  [PLAN_IDS.PRO]: 20,
  [PLAN_IDS.ENTERPRISE]: null,
};

/** Fallback resume quotas if `plans/{id}.monthlyResumeAnalysisLimit` is missing. `null` = unlimited. */
export const PLAN_MONTHLY_RESUME_ANALYSIS_LIMITS: Record<BillingPlanId, number | null> = {
  [PLAN_IDS.FREE]: 2,
  [PLAN_IDS.PRO]: 5,
  [PLAN_IDS.ENTERPRISE]: null,
};

export const PLAN_DEFAULTS = {
  [PLAN_IDS.FREE]: { duration: 0, interviewCredits: 10 },
  [PLAN_IDS.PRO]: { duration: 30, interviewCredits: 20 },
  [PLAN_IDS.ENTERPRISE]: { duration: 365, interviewCredits: -1 },
} as const;
