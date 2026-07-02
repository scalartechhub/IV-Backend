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

export const PLAN_DEFAULTS = {
  [PLAN_IDS.FREE]: { duration: 0, interviewCredits: 3 },
  [PLAN_IDS.PRO]: { duration: 30, interviewCredits: -1 },
  [PLAN_IDS.ENTERPRISE]: { duration: 365, interviewCredits: -1 },
} as const;
