import {
  PLAN_MONTHLY_INTERVIEW_LIMITS,
  PLAN_IDS,
  type BillingPlanId,
} from "../constants/payment.constants";
import {
  PRO_ALLOWED_DIFFICULTIES,
  STARTER_ALLOWED_DIFFICULTIES,
  type DifficultyLevel,
  type SubscriptionPlan,
} from "./constants";
import { AppError } from "./utils";

export const assertDifficultyAllowedForPlan = (
  plan: SubscriptionPlan,
  difficulty: DifficultyLevel
): void => {
  const allowed = plan === "pro" ? PRO_ALLOWED_DIFFICULTIES : STARTER_ALLOWED_DIFFICULTIES;

  if (!allowed.includes(difficulty)) {
    throw new AppError(
      403,
      `Your plan does not allow "${difficulty}" difficulty. Please upgrade to the Pro plan.`
    );
  }
};

export const assertInterviewCreationAllowed = (
  billingPlan: BillingPlanId,
  interviewsUsedThisMonth: number
): void => {
  const limit = PLAN_MONTHLY_INTERVIEW_LIMITS[billingPlan];

  if (limit === null || interviewsUsedThisMonth < limit) {
    return;
  }

  if (billingPlan === PLAN_IDS.FREE) {
    throw new AppError(
      403,
      `You have reached your monthly limit of ${limit} interviews. Please upgrade to the Pro plan to create more interviews.`
    );
  }

  if (billingPlan === PLAN_IDS.PRO) {
    throw new AppError(
      403,
      `You have reached your monthly limit of ${limit} interviews. Please upgrade to the Enterprise plan to create more interviews.`
    );
  }

  throw new AppError(403, "You have reached your monthly interview limit.");
};
