/**
 * Razorpay subscription lifecycle service.
 * Handles: create subscription, verify payment, get current, cancel, payment history.
 */

import { Timestamp } from "firebase-admin/firestore";
import { createHmac } from "crypto";
import { db } from "../../config/firebase";
import { getRazorpay, getRazorpayConfig } from "../../config/razorpay";
import { BILLING_PLAN_IDS, BILLING_PLAN_TO_TIER, PLAN_IDS, SUBSCRIPTION_STATUS } from "../../constants/payment.constants";
import type { BillingPlanIdWithCycle } from "../../constants/payment.constants";
import { COLLECTIONS } from "../../shared/constants";
import { AppError } from "../../shared/utils";
import { logger } from "../../shared/logger";
import type {
  CreateSubscriptionResponse,
  PlanPublicInfo,
  SubscriptionPaymentRecord,
  SubscriptionPlan,
  SubscriptionRecord,
  SubscriptionSummary,
  VerifyPaymentInput,
} from "../payment/payment.model";

// ---------------------------------------------------------------------------
// COLLECTIONS
// ---------------------------------------------------------------------------
const plansCol = () => db.collection(COLLECTIONS.PLANS);
const subsCol = () => db.collection(COLLECTIONS.SUBSCRIPTIONS);
const paymentsCol = () => db.collection(COLLECTIONS.PAYMENTS);
const usersCol = () => db.collection(COLLECTIONS.USERS);

// ---------------------------------------------------------------------------
// GET PLANS (public)
// ---------------------------------------------------------------------------

export const getActivePlans = async (): Promise<PlanPublicInfo[]> => {
  const snap = await plansCol().where("active", "==", true).get();
  return snap.docs.map((doc) => {
    const data = doc.data() as SubscriptionPlan;
    return {
      id: data.id,
      name: data.name,
      billingCycle: data.billingCycle,
      currency: data.currency,
      displayPrice: data.displayPrice,
      displayPeriod: data.displayPeriod,
      annualAmount: data.annualAmount,
      discountPercent: data.discountPercent,
      description: data.description,
      billingDescription: data.billingDescription,
      features: data.features,
      active: data.active,
    };
  });
};

// ---------------------------------------------------------------------------
// CREATE SUBSCRIPTION
// ---------------------------------------------------------------------------

export const createSubscription = async (
  uid: string,
  planId: BillingPlanIdWithCycle | string
): Promise<CreateSubscriptionResponse> => {
  // 1. Validate plan
  if (planId === BILLING_PLAN_IDS.FREE) {
    throw new AppError(400, "Free plan does not require a subscription. Use the dashboard directly.");
  }

  const planDoc = await plansCol().doc(planId).get();
  if (!planDoc.exists) {
    throw new AppError(400, "Invalid plan. Please select a valid subscription plan.");
  }

  const plan = { id: planDoc.id, ...planDoc.data() } as SubscriptionPlan;
  if (!plan.active) {
    throw new AppError(400, "This plan is currently unavailable. Please try another plan.");
  }
  if (!plan.razorpayPlanId) {
    throw new AppError(503, "Payment configuration is incomplete for this plan. Please contact support.");
  }

  // 2. Check for existing active subscription
  const userDoc = await usersCol().doc(uid).get();
  const existingSummary = userDoc.data()?.subscriptionSummary as SubscriptionSummary | undefined;

  if (
    existingSummary &&
    existingSummary.status === SUBSCRIPTION_STATUS.ACTIVE &&
    existingSummary.provider === "razorpay"
  ) {
    throw new AppError(409, "You already have an active subscription. Please manage your current plan before subscribing to a new one.", [
      { field: "planId", message: "ACTIVE_SUBSCRIPTION_EXISTS" },
    ]);
  }

  // 3. Create Razorpay subscription
  const razorpay = getRazorpay();
  const { keyId } = getRazorpayConfig();

  let razorpaySub: Record<string, unknown>;
  try {
    razorpaySub = await (razorpay.subscriptions as any).create({
      plan_id: plan.razorpayPlanId,
      total_count: plan.billingCycle === "yearly" ? 10 : 120, // max billing cycles
      quantity: 1,
      notes: {
        userId: uid,
        planId: plan.id,
        planName: plan.name,
      },
    });
  } catch (err: any) {
    logger.error("[razorpay-subscription] Failed to create Razorpay subscription", {
      uid,
      planId,
      error: err.message,
    });
    throw new AppError(502, "Unable to create subscription. Please try again later.");
  }

  const rzpSubId = String(razorpaySub.id);

  // 4. Save pending subscription in Firestore
  const now = new Date().toISOString();
  const subRecord: SubscriptionRecord = {
    userId: uid,
    provider: "razorpay",
    razorpaySubscriptionId: rzpSubId,
    ...(razorpaySub.customer_id ? { razorpayCustomerId: String(razorpaySub.customer_id) } : {}),
    razorpayPlanId: plan.razorpayPlanId,
    planId: plan.id,
    planName: plan.name,
    billingCycle: plan.billingCycle === "none" ? "monthly" : plan.billingCycle,
    status: SUBSCRIPTION_STATUS.PENDING,
    amount: plan.amount,
    currency: plan.currency,
    cancelAtPeriodEnd: false,
    createdAt: now,
    updatedAt: now,
  };

  await subsCol().doc(rzpSubId).set(subRecord);

  logger.info("[razorpay-subscription] Created pending subscription", {
    uid,
    planId,
    rzpSubId,
  });

  return {
    subscriptionId: rzpSubId,
    keyId,
    planId: plan.id,
    planName: plan.name,
    billingCycle: plan.billingCycle === "none" ? "monthly" : plan.billingCycle,
    amount: plan.amount,
    currency: plan.currency,
  };
};

// ---------------------------------------------------------------------------
// VERIFY PAYMENT
// ---------------------------------------------------------------------------

export const verifyPayment = async (
  uid: string,
  input: VerifyPaymentInput
): Promise<{ verified: boolean; subscriptionId: string }> => {
  const { razorpayPaymentId, razorpaySubscriptionId, razorpaySignature } = input;

  // Verify signature: HMAC SHA256(razorpayPaymentId + "|" + razorpaySubscriptionId, key_secret)
  const { keySecret } = getRazorpayConfig();
  if (!keySecret) {
    throw new AppError(503, "Payment verification is not configured. Please contact support.");
  }

  const expectedSignature = createHmac("sha256", keySecret)
    .update(`${razorpayPaymentId}|${razorpaySubscriptionId}`)
    .digest("hex");

  if (expectedSignature !== razorpaySignature) {
    logger.warn("[razorpay-subscription] Payment verification failed — signature mismatch", {
      uid,
      razorpaySubscriptionId,
    });
    throw new AppError(400, "Payment verification failed. Please contact support if you were charged.");
  }

  // Verify ownership — the subscription must belong to this user
  const subDoc = await subsCol().doc(razorpaySubscriptionId).get();
  if (!subDoc.exists || (subDoc.data() as SubscriptionRecord).userId !== uid) {
    throw new AppError(403, "Subscription not found or does not belong to this user.");
  }

  const subData = subDoc.data() as SubscriptionRecord;
  const now = new Date().toISOString();
  const periodEnd = new Date(Date.now() + (subData.billingCycle === "yearly" ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString();

  // 1. Activate subscription record in Firestore
  await subsCol().doc(razorpaySubscriptionId).update({
    status: SUBSCRIPTION_STATUS.ACTIVE,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    updatedAt: now,
  });

  // 2. Update user's subscriptionSummary & legacy subscription field
  const tier = BILLING_PLAN_TO_TIER[subData.planId as BillingPlanIdWithCycle] || "pro";
  await usersCol().doc(uid).set(
    {
      subscriptionSummary: {
        planId: subData.planId,
        planName: subData.planName,
        billingCycle: subData.billingCycle,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        provider: "razorpay",
        razorpaySubscriptionId,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        updatedAt: now,
      },
      subscription: {
        plan: tier,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        expiresAt: periodEnd,
        purchaseDate: now,
        interviewCredits: -1,
      },
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  // 3. Record payment in payments collection
  const paymentRecord: SubscriptionPaymentRecord = {
    userId: uid,
    razorpayPaymentId,
    razorpaySubscriptionId,
    planId: subData.planId,
    amount: subData.amount,
    currency: subData.currency,
    status: "captured",
    createdAt: now,
    updatedAt: now,
  };
  await paymentsCol().doc(razorpayPaymentId).set(paymentRecord, { merge: true });

  logger.info("[razorpay-subscription] Payment verified and subscription activated", {
    uid,
    razorpaySubscriptionId,
    razorpayPaymentId,
  });

  return { verified: true, subscriptionId: razorpaySubscriptionId };
};

// ---------------------------------------------------------------------------
// SYNC USER SUBSCRIPTION WITH RAZORPAY (Self-Healing)
// ---------------------------------------------------------------------------

export const syncUserSubscriptionWithRazorpay = async (
  uid: string
): Promise<SubscriptionSummary | null> => {
  try {
    const razorpay = getRazorpay();
    const subsSnap = await subsCol().where("userId", "==", uid).get();
    if (subsSnap.empty) return null;

    // Check recent subscriptions
    for (const doc of subsSnap.docs) {
      const subRecord = doc.data() as SubscriptionRecord;
      try {
        const rzpSub = await (razorpay.subscriptions as any).fetch(subRecord.razorpaySubscriptionId);
        if (rzpSub && (rzpSub.status === "active" || rzpSub.status === "completed")) {
          const now = new Date().toISOString();
          const currentPeriodStart = rzpSub.current_start ? new Date(rzpSub.current_start * 1000).toISOString() : now;
          const currentPeriodEnd = rzpSub.current_end ? new Date(rzpSub.current_end * 1000).toISOString() : undefined;
          const planId = subRecord.planId || rzpSub.notes?.planId || "pro_monthly";
          const planName = subRecord.planName || rzpSub.notes?.planName || "Pro";
          const tier = BILLING_PLAN_TO_TIER[planId as BillingPlanIdWithCycle] || "pro";

          const summary: SubscriptionSummary = {
            planId,
            planName,
            billingCycle: subRecord.billingCycle || "monthly",
            status: SUBSCRIPTION_STATUS.ACTIVE,
            provider: "razorpay",
            razorpaySubscriptionId: subRecord.razorpaySubscriptionId,
            currentPeriodStart,
            currentPeriodEnd,
            cancelAtPeriodEnd: Boolean(rzpSub.cancel_at_cycle_end),
            updatedAt: now,
          };

          // 1. Update subscription document in Firestore
          await subsCol().doc(doc.id).update({
            status: SUBSCRIPTION_STATUS.ACTIVE,
            currentPeriodStart,
            currentPeriodEnd,
            ...(rzpSub.customer_id ? { razorpayCustomerId: String(rzpSub.customer_id) } : {}),
            updatedAt: now,
          });

          // 2. Update user document in Firestore
          await usersCol().doc(uid).set(
            {
              subscriptionSummary: summary,
              subscription: {
                plan: tier,
                status: SUBSCRIPTION_STATUS.ACTIVE,
                expiresAt: currentPeriodEnd || null,
                purchaseDate: now,
                interviewCredits: -1,
              },
              planTier: tier,
              updatedAt: Timestamp.now(),
            },
            { merge: true }
          );

          // 3. Sync paid invoices to payments collection
          try {
            const invoices = await (razorpay.invoices as any).all({ subscription_id: subRecord.razorpaySubscriptionId });
            if (invoices?.items) {
              for (const inv of invoices.items) {
                if (inv.payment_id && (inv.status === "paid" || inv.status === "issued")) {
                  const paymentRecord: SubscriptionPaymentRecord = {
                    userId: uid,
                    razorpayPaymentId: inv.payment_id,
                    razorpaySubscriptionId: subRecord.razorpaySubscriptionId,
                    planId,
                    amount: inv.amount ? inv.amount / 100 : subRecord.amount || 0,
                    currency: inv.currency || subRecord.currency || "INR",
                    status: inv.status === "paid" ? "captured" : inv.status,
                    method: "card",
                    createdAt: inv.paid_at
                      ? new Date(inv.paid_at * 1000).toISOString()
                      : new Date((inv.created_at || Date.now() / 1000) * 1000).toISOString(),
                    updatedAt: now,
                  };
                  await paymentsCol().doc(inv.payment_id).set(paymentRecord, { merge: true });
                }
              }
            }
          } catch (invErr: any) {
            logger.warn("[razorpay-subscription] Failed to sync invoices during sub sync", {
              subscriptionId: subRecord.razorpaySubscriptionId,
              error: invErr.message,
            });
          }

          logger.info("[razorpay-subscription] Self-healing sync activated subscription", {
            uid,
            subscriptionId: subRecord.razorpaySubscriptionId,
            planId,
          });

          return summary;
        }
      } catch (err: any) {
        logger.warn("[razorpay-subscription] Error fetching sub from Razorpay during sync", {
          subscriptionId: subRecord.razorpaySubscriptionId,
          error: err.message,
        });
      }
    }
  } catch (err: any) {
    logger.warn("[razorpay-subscription] Error during subscription sync", {
      uid,
      error: err.message,
    });
  }

  return null;
};

// ---------------------------------------------------------------------------
// GET CURRENT SUBSCRIPTION
// ---------------------------------------------------------------------------

export const getCurrentSubscription = async (
  uid: string
): Promise<{
  planId: string;
  planName: string;
  status: string;
  billingCycle: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  provider: string;
  razorpaySubscriptionId?: string;
}> => {
  const userDoc = await usersCol().doc(uid).get();
  const userData = userDoc.data();
  let summary = userData?.subscriptionSummary as SubscriptionSummary | undefined;

  // 1. If no active paid summary on user document, attempt self-healing sync from Razorpay
  if (
    !summary ||
    summary.status !== SUBSCRIPTION_STATUS.ACTIVE ||
    summary.planId === PLAN_IDS.FREE ||
    summary.planId === "free"
  ) {
    const synced = await syncUserSubscriptionWithRazorpay(uid);
    if (synced) {
      summary = synced;
    }
  }

  // 2. Check legacy subscription field if still not active
  if (!summary || summary.status !== SUBSCRIPTION_STATUS.ACTIVE) {
    const legacy = userData?.subscription;
    if (
      legacy &&
      (legacy.status === SUBSCRIPTION_STATUS.ACTIVE || legacy.status === "active") &&
      legacy.plan &&
      legacy.plan !== PLAN_IDS.FREE
    ) {
      const planName = legacy.plan === PLAN_IDS.ELITE ? "Elite" : "Pro";
      return {
        planId: legacy.plan,
        planName,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        billingCycle: "monthly",
        currentPeriodEnd: legacy.expiresAt || undefined,
        cancelAtPeriodEnd: false,
        provider: "legacy",
      };
    }

    return {
      planId: "free",
      planName: "Free",
      status: SUBSCRIPTION_STATUS.ACTIVE,
      billingCycle: "none",
      cancelAtPeriodEnd: false,
      provider: "none",
    };
  }

  return {
    planId: summary.planId,
    planName: summary.planName,
    status: summary.status,
    billingCycle: summary.billingCycle,
    currentPeriodEnd: summary.currentPeriodEnd,
    cancelAtPeriodEnd: summary.cancelAtPeriodEnd,
    provider: summary.provider,
    razorpaySubscriptionId: summary.razorpaySubscriptionId,
  };
};

// ---------------------------------------------------------------------------
// CANCEL SUBSCRIPTION
// ---------------------------------------------------------------------------

export const cancelSubscription = async (uid: string): Promise<{ cancelledAtPeriodEnd: boolean }> => {
  const userDoc = await usersCol().doc(uid).get();
  const summary = userDoc.data()?.subscriptionSummary as SubscriptionSummary | undefined;

  if (!summary || summary.status !== SUBSCRIPTION_STATUS.ACTIVE || summary.provider !== "razorpay") {
    throw new AppError(404, "No active Razorpay subscription found.");
  }

  if (summary.cancelAtPeriodEnd) {
    throw new AppError(400, "Your subscription is already set to cancel at the end of the current billing period.");
  }

  const rzpSubId = summary.razorpaySubscriptionId;
  if (!rzpSubId) {
    throw new AppError(500, "Subscription ID is missing. Please contact support.");
  }

  // Cancel on Razorpay at period end
  const razorpay = getRazorpay();
  try {
    await (razorpay.subscriptions as any).cancel(rzpSubId, { cancel_at_cycle_end: 1 });
  } catch (err: any) {
    logger.error("[razorpay-subscription] Failed to cancel Razorpay subscription", {
      uid,
      rzpSubId,
      error: err.message,
    });
    throw new AppError(502, "Unable to cancel subscription. Please try again later.");
  }

  // Update Firestore
  const now = new Date().toISOString();
  const batch = db.batch();

  batch.update(usersCol().doc(uid), {
    "subscriptionSummary.cancelAtPeriodEnd": true,
    "subscriptionSummary.updatedAt": now,
    updatedAt: Timestamp.now(),
  });

  batch.update(subsCol().doc(rzpSubId), {
    cancelAtPeriodEnd: true,
    updatedAt: now,
  });

  await batch.commit();

  logger.info("[razorpay-subscription] Subscription cancelled at period end", { uid, rzpSubId });

  return { cancelledAtPeriodEnd: true };
};

// ---------------------------------------------------------------------------
// PAYMENT HISTORY
// ---------------------------------------------------------------------------

export const getPaymentHistory = async (
  uid: string,
  limit = 20
): Promise<SubscriptionPaymentRecord[]> => {
  try {
    let snap = await paymentsCol().where("userId", "==", uid).get();

    // If payments collection has no records for this user, attempt to discover them from Razorpay invoices
    if (snap.empty) {
      try {
        const razorpay = getRazorpay();
        const subIds = new Set<string>();

        const userDoc = await usersCol().doc(uid).get();
        const userData = userDoc.data();
        if (userData?.subscriptionSummary?.razorpaySubscriptionId) {
          subIds.add(userData.subscriptionSummary.razorpaySubscriptionId);
        }
        if (userData?.subscription?.razorpaySubscriptionId) {
          subIds.add(userData.subscription.razorpaySubscriptionId);
        }

        const subsSnap = await subsCol().where("userId", "==", uid).get();
        subsSnap.docs.forEach((d) => {
          const s = d.data() as SubscriptionRecord;
          if (s.razorpaySubscriptionId) subIds.add(s.razorpaySubscriptionId);
        });

        for (const subId of subIds) {
          try {
            const invoices = await (razorpay.invoices as any).all({ subscription_id: subId });
            if (invoices?.items) {
              for (const inv of invoices.items) {
                if (inv.payment_id && (inv.status === "paid" || inv.status === "issued")) {
                  const paymentRecord: SubscriptionPaymentRecord = {
                    userId: uid,
                    razorpayPaymentId: inv.payment_id,
                    razorpaySubscriptionId: subId,
                    planId:
                      userData?.subscriptionSummary?.planId && userData.subscriptionSummary.planId !== "free"
                        ? userData.subscriptionSummary.planId
                        : "pro_monthly",
                    amount: inv.amount ? inv.amount / 100 : 0,
                    currency: inv.currency || "INR",
                    status: inv.status === "paid" ? "captured" : inv.status,
                    method: "card",
                    createdAt: inv.paid_at
                      ? new Date(inv.paid_at * 1000).toISOString()
                      : new Date((inv.created_at || Date.now() / 1000) * 1000).toISOString(),
                    updatedAt: new Date().toISOString(),
                  };
                  await paymentsCol().doc(inv.payment_id).set(paymentRecord, { merge: true });
                }
              }
            }
          } catch (invErr: any) {
            logger.warn("[razorpay-subscription] Failed to fetch invoices during getPaymentHistory", {
              subId,
              error: invErr.message,
            });
          }
        }

        snap = await paymentsCol().where("userId", "==", uid).get();
      } catch (syncErr: any) {
        logger.warn("[razorpay-subscription] Could not sync payments from Razorpay", {
          uid,
          error: syncErr.message,
        });
      }
    }

    const records = snap.docs.map((doc) => doc.data() as SubscriptionPaymentRecord);
    // Sort in-memory to prevent missing composite index errors on (userId ASC, createdAt DESC)
    records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return records.slice(0, limit);
  } catch (err: any) {
    logger.error("[razorpay-subscription] Error fetching payment history", { uid, error: err.message });
    return [];
  }
};

// ---------------------------------------------------------------------------
// ACTIVATE FREE PLAN
// ---------------------------------------------------------------------------

export const activateFreePlan = async (uid: string): Promise<void> => {
  const now = new Date().toISOString();
  const summary: SubscriptionSummary = {
    planId: "free",
    planName: "Free",
    billingCycle: "none",
    status: SUBSCRIPTION_STATUS.ACTIVE,
    provider: "none",
    cancelAtPeriodEnd: false,
    updatedAt: now,
  };

  await usersCol().doc(uid).set(
    {
      subscriptionSummary: summary,
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );
};
