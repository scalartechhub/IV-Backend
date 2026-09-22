export const SUBSCRIPTION_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  EXPIRED: "expired",
  FAILED: "failed",
  PENDING: "pending",
  CANCELLED: "cancelled",
  HALTED: "halted",
  COMPLETED: "completed",
} as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

/** Logical plan tiers (no billing cycle). */
export const PLAN_IDS = {
  FREE: "free",
  PRO: "pro",
  ELITE: "elite",
  /** @deprecated Use ELITE — kept for backward compatibility with existing Firestore docs. */
  ENTERPRISE: "enterprise",
} as const;

export type BillingPlanId = (typeof PLAN_IDS)[keyof typeof PLAN_IDS];

/** Billing-cycle-specific plan IDs used in Razorpay subscriptions. */
export const BILLING_PLAN_IDS = {
  FREE: "free",
  PRO_MONTHLY: "pro_monthly",
  PRO_YEARLY: "pro_yearly",
  ELITE_MONTHLY: "elite_monthly",
  ELITE_YEARLY: "elite_yearly",
} as const;

export type BillingPlanIdWithCycle = (typeof BILLING_PLAN_IDS)[keyof typeof BILLING_PLAN_IDS];

/** Map a billing plan ID to its logical tier. */
export const BILLING_PLAN_TO_TIER: Record<BillingPlanIdWithCycle, BillingPlanId> = {
  [BILLING_PLAN_IDS.FREE]: PLAN_IDS.FREE,
  [BILLING_PLAN_IDS.PRO_MONTHLY]: PLAN_IDS.PRO,
  [BILLING_PLAN_IDS.PRO_YEARLY]: PLAN_IDS.PRO,
  [BILLING_PLAN_IDS.ELITE_MONTHLY]: PLAN_IDS.ELITE,
  [BILLING_PLAN_IDS.ELITE_YEARLY]: PLAN_IDS.ELITE,
};

export const BILLING_CYCLES = {
  MONTHLY: "monthly",
  YEARLY: "yearly",
} as const;

export type BillingCycle = (typeof BILLING_CYCLES)[keyof typeof BILLING_CYCLES];

/** Fallback interview quotas if `plans/{id}.monthlyInterviewLimit` is missing. `null` = unlimited. */
export const PLAN_MONTHLY_INTERVIEW_LIMITS: Record<BillingPlanId, number | null> = {
  [PLAN_IDS.FREE]: 3,
  [PLAN_IDS.PRO]: 15,
  [PLAN_IDS.ELITE]: null,
  [PLAN_IDS.ENTERPRISE]: null,
};

/** Fallback resume quotas if `plans/{id}.monthlyResumeAnalysisLimit` is missing. `null` = unlimited. */
export const PLAN_MONTHLY_RESUME_ANALYSIS_LIMITS: Record<BillingPlanId, number | null> = {
  [PLAN_IDS.FREE]: 1,
  [PLAN_IDS.PRO]: 3,
  [PLAN_IDS.ELITE]: null,
  [PLAN_IDS.ENTERPRISE]: null,
};

export const PLAN_DEFAULTS = {
  [PLAN_IDS.FREE]: { duration: 0, interviewCredits: 3 },
  [PLAN_IDS.PRO]: { duration: 30, interviewCredits: 15 },
  [PLAN_IDS.ELITE]: { duration: 365, interviewCredits: -1 },
  [PLAN_IDS.ENTERPRISE]: { duration: 365, interviewCredits: -1 },
} as const;

/** Centralized feature access map — single source of truth for feature gating. */
export const PLAN_FEATURES = {
  [PLAN_IDS.FREE]: {
    interviewsPerMonth: 3,
    resumeAnalysis: "basic" as const, // 1/month
    codingPractice: "limited" as const,
    learningRoadmap: false, // NOT allowed for free
    careerProgress: false, // NOT allowed for free
    companyPreparation: false, // NOT allowed for free
    nearbyCompanies: false, // NOT allowed for free
    advancedReports: false,
    careerCoach: false,
    atsScan: false,
    personalizedRoadmap: false,
    systemDesign: false,
    behavioralInterview: false,
    jobMatchInsights: false,
    earlyAccess: false,
    prioritySupport: false,
  },
  [PLAN_IDS.PRO]: {
    interviewsPerMonth: 15,
    resumeAnalysis: "advanced" as const, // 3/month
    codingPractice: "unlimited" as const,
    learningRoadmap: "full" as const,
    careerProgress: "full" as const,
    companyPreparation: true,
    nearbyCompanies: true,
    advancedReports: true,
    careerCoach: true,
    atsScan: true,
    personalizedRoadmap: true,
    systemDesign: false,
    behavioralInterview: false,
    jobMatchInsights: false,
    earlyAccess: false,
    prioritySupport: false,
  },
  [PLAN_IDS.ELITE]: {
    interviewsPerMonth: null, // unlimited
    resumeAnalysis: "unlimited" as const, // unlimited
    codingPractice: "unlimited" as const,
    learningRoadmap: "full" as const,
    careerProgress: "full" as const,
    companyPreparation: true,
    nearbyCompanies: true,
    advancedReports: true,
    careerCoach: true,
    atsScan: true,
    personalizedRoadmap: true,
    systemDesign: true,
    behavioralInterview: true,
    jobMatchInsights: true,
    earlyAccess: true,
    prioritySupport: true,
  },
} as const;

/** @deprecated Alias for backward compat */
(PLAN_FEATURES as Record<string, unknown>)[PLAN_IDS.ENTERPRISE] = PLAN_FEATURES[PLAN_IDS.ELITE];

export type PlanFeatureKey = keyof (typeof PLAN_FEATURES)[typeof PLAN_IDS.FREE];
