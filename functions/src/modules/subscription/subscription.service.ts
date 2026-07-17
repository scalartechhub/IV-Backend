import { Timestamp } from "firebase-admin/firestore";
import { db } from "../../config/firebase";
import { PLAN_DEFAULTS, PLAN_IDS, SUBSCRIPTION_STATUS } from "../../constants/payment.constants";
import type { User } from "../auth/auth.types";
import { assertUserCanAnalyzeResume, requireUserById } from "../auth/auth.repository";
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

/** Resolves effective subscription from an already-loaded user (no Firestore read). */
export const resolveSubscriptionFromUser = (user: User | null | undefined): UserSubscription => {
  const subscription = user?.subscription as UserSubscription | undefined;
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

/** Resolves the effective subscription, downgrading expired paid plans to free defaults. */
export const resolveUserSubscription = async (uid: string): Promise<UserSubscription> => {
  const snap = await getUsersCollection().doc(uid).get();
  if (!snap.exists) return buildFreeSubscription();

  return resolveSubscriptionFromUser(snap.data() as User);
};

export const assertActiveSubscriptionForUser = (user: User): UserSubscription => {
  const subscription = resolveSubscriptionFromUser(user);

  if (subscription.status === SUBSCRIPTION_STATUS.EXPIRED) {
    throw new AppError(403, "Your subscription has expired. Please renew to continue.");
  }

  if (subscription.status !== SUBSCRIPTION_STATUS.ACTIVE) {
    throw new AppError(403, "Your subscription is not active. Please upgrade your plan.");
  }

  return subscription;
};

export const assertActiveSubscription = async (uid: string): Promise<UserSubscription> => {
  const snap = await getUsersCollection().doc(uid).get();
  if (!snap.exists) {
    return assertActiveSubscriptionForUser({
      uid,
      displayName: "",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      subscription: buildFreeSubscription(),
    } as User);
  }

  return assertActiveSubscriptionForUser({ ...(snap.data() as User), uid });
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
  const user = await requireUserById(uid);
  await assertUserCanAnalyzeResume(uid, user);
};
