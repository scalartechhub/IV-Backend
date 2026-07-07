import {
  PLAN_IDS,
  SUBSCRIPTION_STATUS,
  type BillingPlanId,
} from "../constants/payment.constants";
import type { User } from "../modules/auth/auth.types";

const isSubscriptionActive = (user: User): boolean => {
  const status = user.subscription?.status;
  if (status && status !== SUBSCRIPTION_STATUS.ACTIVE) {
    return false;
  }

  const expiresAt = user.subscription?.expiresAt;
  if (!expiresAt) {
    return true;
  }

  const expiry = new Date(expiresAt);
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() > Date.now();
};

export const resolveBillingPlan = (user: User): BillingPlanId => {
  const rawPlan = user.subscription?.plan?.toLowerCase().trim();

  if (rawPlan === PLAN_IDS.ENTERPRISE && isSubscriptionActive(user)) {
    return PLAN_IDS.ENTERPRISE;
  }

  if (rawPlan === PLAN_IDS.PRO && isSubscriptionActive(user)) {
    return PLAN_IDS.PRO;
  }

  return PLAN_IDS.FREE;
};

export const getStartOfCurrentMonth = (): Date => {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start;
};

export const getStartOfNextMonth = (): Date => {
  const next = new Date();
  next.setMonth(next.getMonth() + 1, 1);
  next.setHours(0, 0, 0, 0);
  return next;
};
