import { Timestamp } from "firebase-admin/firestore";
import { db } from "../../config/firebase";
import { PLAN_DEFAULTS, PLAN_IDS, SUBSCRIPTION_STATUS } from "../../constants/payment.constants";
import type { UserSubscription } from "../payment/payment.model";
import { AppError } from "../../shared/utils";

const getUsersCollection = () => db.collection("users");

const FREE_DEFAULTS = PLAN_DEFAULTS[PLAN_IDS.FREE];

const isUnlimitedCredits = (credits: number): boolean => credits < 0;

export const isSubscriptionExpired = (expiresAt: string | null | undefined): boolean => {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
};

const buildFreeSubscription = (): UserSubscription => ({
  plan: PLAN_IDS.FREE,
  status: SUBSCRIPTION_STATUS.ACTIVE,
  expiresAt: null,
  purchaseDate: null,
  interviewCredits: FREE_DEFAULTS.interviewCredits,
  currentPaymentId: null,
});

/** Resolves the effective subscription, downgrading expired paid plans to free defaults. */
export const resolveUserSubscription = async (uid: string): Promise<UserSubscription> => {
  const snap = await getUsersCollection().doc(uid).get();
  if (!snap.exists) return buildFreeSubscription();

  const subscription = (snap.data() as { subscription?: UserSubscription }).subscription;
  if (!subscription) return buildFreeSubscription();

  if (
    subscription.status === SUBSCRIPTION_STATUS.ACTIVE &&
    subscription.plan !== PLAN_IDS.FREE &&
    isSubscriptionExpired(subscription.expiresAt)
  ) {
    return {
      ...buildFreeSubscription(),
      status: SUBSCRIPTION_STATUS.EXPIRED,
    };
  }

  if (subscription.status === SUBSCRIPTION_STATUS.FAILED) {
    return buildFreeSubscription();
  }

  return subscription;
};

export const assertActiveSubscription = async (uid: string): Promise<UserSubscription> => {
  const subscription = await resolveUserSubscription(uid);

  if (subscription.status === SUBSCRIPTION_STATUS.EXPIRED) {
    throw new AppError(403, "Your subscription has expired. Please renew to continue.");
  }

  if (subscription.status !== SUBSCRIPTION_STATUS.ACTIVE) {
    throw new AppError(403, "Your subscription is not active. Please upgrade your plan.");
  }

  return subscription;
};

export const assertCanCreateInterview = async (uid: string): Promise<void> => {
  const subscription = await assertActiveSubscription(uid);

  if (isUnlimitedCredits(subscription.interviewCredits)) return;

  if (subscription.interviewCredits <= 0) {
    throw new AppError(
      403,
      "Interview limit reached for your current plan. Please upgrade to continue."
    );
  }
};

export const recordInterviewUsage = async (uid: string): Promise<void> => {
  const ref = getUsersCollection().doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const subscription =
      (snap.data() as { subscription?: UserSubscription } | undefined)?.subscription ??
      buildFreeSubscription();

    if (isUnlimitedCredits(subscription.interviewCredits)) return;

    const nextCredits = Math.max(0, subscription.interviewCredits - 1);
    tx.set(
      ref,
      {
        uid,
        subscription: { ...subscription, interviewCredits: nextCredits },
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
  });
};

export const assertCanUploadResume = async (uid: string): Promise<void> => {
  await assertActiveSubscription(uid);
};
