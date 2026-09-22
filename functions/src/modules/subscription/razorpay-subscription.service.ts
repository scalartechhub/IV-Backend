/**
 * Razorpay subscription lifecycle service.
 * Handles: create subscription, verify payment, get current, cancel, payment history.
 */

import { Timestamp, FieldValue } from "firebase-admin/firestore";
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

import { getInrPerUsdRate, convertInrToUsd } from "./currency.service";

// ---------------------------------------------------------------------------
// COLLECTIONS
// ---------------------------------------------------------------------------
const plansCol = () => db.collection(COLLECTIONS.PLANS);
const subsCol = () => db.collection(COLLECTIONS.SUBSCRIPTIONS);
const paymentsCol = () => db.collection(COLLECTIONS.PAYMENTS);
const usersCol = () => db.collection(COLLECTIONS.USERS);

export const getPlanTierRank = (planIdOrName?: string): number => {
  const str = (planIdOrName || "").toLowerCase();
  if (str.includes("elite")) return 2;
  if (str.includes("pro")) return 1;
  return 0; // free
};

// ---------------------------------------------------------------------------
// GET PLANS (public)
// ---------------------------------------------------------------------------

export const getActivePlans = async (): Promise<PlanPublicInfo[]> => {
  const [snap, inrPerUsd] = await Promise.all([
    plansCol().where("active", "==", true).get(),
    getInrPerUsdRate(),
  ]);

  return snap.docs.map((doc) => {
    const data = doc.data() as SubscriptionPlan;
    const isYearly = data.billingCycle === "yearly";

    let displayPrice = data.displayPrice;
    let annualAmount = data.annualAmount;
    let billingDescription = data.billingDescription;

    // Dynamically calculate live USD prices from INR amount
    if (data.currency === "INR" && typeof data.amount === "number" && data.amount > 0) {
      if (isYearly) {
        annualAmount = convertInrToUsd(data.amount, inrPerUsd);
        displayPrice = Number((annualAmount / 12).toFixed(2));
        const discount = data.discountPercent || 20;
        billingDescription = `Billed annually at $${annualAmount}/year (Save ${discount}%).`;
      } else {
        displayPrice = convertInrToUsd(data.amount, inrPerUsd);
        billingDescription = "Billed monthly. Cancel anytime.";
      }
    } else if (data.amount === 0) {
      displayPrice = 0;
      annualAmount = undefined;
    }

    return {
      id: data.id || doc.id,
      name: data.name,
      billingCycle: data.billingCycle,
      currency: data.currency,
      amount: data.amount,
      displayPrice,
      displayPeriod: data.displayPeriod,
      annualAmount,
      discountPercent: data.discountPercent,
      description: data.description,
      billingDescription,
      features: data.features,
      active: data.active,
      exchangeRate: inrPerUsd,
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

  // 2. No duplicate guard here — paid users may create a new subscription to switch billing
  //    cycles. Double-billing protection is handled in verifyPayment() which cancels the
  //    old subscription before activating the new one.

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

  // 4. Clean up any previous abandoned pending subscriptions for this user
  const now = new Date().toISOString();
  try {
    const priorPending = await subsCol()
      .where("userId", "==", uid)
      .where("status", "==", SUBSCRIPTION_STATUS.PENDING)
      .get();
    if (!priorPending.empty) {
      const cleanupBatch = db.batch();
      for (const doc of priorPending.docs) {
        cleanupBatch.update(doc.ref, {
          status: SUBSCRIPTION_STATUS.CANCELLED,
          updatedAt: now,
        });
      }
      await cleanupBatch.commit();
    }
  } catch (cleanErr: any) {
    logger.warn("[razorpay-subscription] Error cleaning prior pending subscriptions", { error: cleanErr.message });
  }

  // 5. Save new pending subscription in Firestore
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

  // 1a. If user already had a different active Razorpay subscription, cancel the old one so they aren't double-billed
  const existingUserDoc = await usersCol().doc(uid).get();
  const existingSummary = existingUserDoc.data()?.subscriptionSummary as SubscriptionSummary | undefined;
  if (
    existingSummary &&
    existingSummary.status === SUBSCRIPTION_STATUS.ACTIVE &&
    existingSummary.razorpaySubscriptionId &&
    existingSummary.razorpaySubscriptionId !== razorpaySubscriptionId
  ) {
    const oldRzpSubId = existingSummary.razorpaySubscriptionId;
    try {
      const razorpay = getRazorpay();
      await (razorpay.subscriptions as any).cancel(oldRzpSubId, false);
      await subsCol().doc(oldRzpSubId).update({
        status: SUBSCRIPTION_STATUS.CANCELLED,
        cancelAtPeriodEnd: false,
        supersededBy: razorpaySubscriptionId,
        updatedAt: now,
      });
      logger.info("[razorpay-subscription] Old subscription superseded and cancelled on Razorpay", {
        uid,
        oldRzpSubId,
        newRzpSubId: razorpaySubscriptionId,
      });
    } catch (oldSubErr: any) {
      logger.warn("[razorpay-subscription] Note: Could not cancel old subscription on Razorpay", {
        uid,
        oldRzpSubId,
        error: oldSubErr.message,
      });
    }
  }

  // 2. Update user's subscriptionSummary & legacy subscription field
  const tier = BILLING_PLAN_TO_TIER[subData.planId as BillingPlanIdWithCycle] || "pro";
  const currentMonthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

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
      planTier: tier,
      stats: {
        interviewsCreatedThisMonth: 0,
        interviewsMonthKey: currentMonthKey,
        resumeAnalysesCreatedThisMonth: 0,
        resumeAnalysesMonthKey: currentMonthKey,
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
  pendingPlanChange?: any;
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
  } else if (
    summary.currentPeriodEnd &&
    summary.planId !== PLAN_IDS.FREE &&
    summary.planId !== "free"
  ) {
    // 1b. If paid summary period has expired, attempt sync to see if renewed or reset to Free
    const periodEndMs = new Date(summary.currentPeriodEnd).getTime();
    if (!isNaN(periodEndMs) && periodEndMs < Date.now()) {
      const synced = await syncUserSubscriptionWithRazorpay(uid);
      if (synced && synced.status === SUBSCRIPTION_STATUS.ACTIVE && synced.planId !== "free") {
        summary = synced;
      } else {
        // Not renewed — forcefully downgrade to Free
        await forceResetUserToFreePlan(uid);
        summary = undefined;
      }
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
    pendingPlanChange: summary.pendingPlanChange || null,
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

  // Cancel on Razorpay at period end (passing true sets cancel_at_cycle_end: 1 in Razorpay Node SDK)
  const razorpay = getRazorpay();
  try {
    await (razorpay.subscriptions as any).cancel(rzpSubId, true);
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
// RESUME / UN-CANCEL SUBSCRIPTION
// ---------------------------------------------------------------------------

export const resumeSubscription = async (uid: string): Promise<{ resumed: boolean }> => {
  const userDoc = await usersCol().doc(uid).get();
  const summary = userDoc.data()?.subscriptionSummary as SubscriptionSummary | undefined;

  if (!summary || summary.status !== SUBSCRIPTION_STATUS.ACTIVE || summary.provider !== "razorpay") {
    throw new AppError(404, "No active Razorpay subscription found.");
  }

  if (!summary.cancelAtPeriodEnd) {
    throw new AppError(400, "Your subscription is not scheduled for cancellation.");
  }

  const rzpSubId = summary.razorpaySubscriptionId;
  if (!rzpSubId) {
    throw new AppError(500, "Subscription ID is missing. Please contact support.");
  }

  const razorpay = getRazorpay();
  try {
    if (typeof (razorpay.subscriptions as any).cancelScheduledChanges === "function") {
      await (razorpay.subscriptions as any).cancelScheduledChanges(rzpSubId);
    } else if (typeof (razorpay.subscriptions as any).resume === "function") {
      await (razorpay.subscriptions as any).resume(rzpSubId);
    }
  } catch (err: any) {
    logger.warn("[razorpay-subscription] Razorpay cancelScheduledChanges/resume note", {
      uid,
      rzpSubId,
      error: err.message,
    });
  }

  // Update Firestore
  const now = new Date().toISOString();
  const batch = db.batch();

  batch.update(usersCol().doc(uid), {
    "subscriptionSummary.cancelAtPeriodEnd": false,
    "subscriptionSummary.pendingPlanChange": FieldValue.delete(),
    "subscriptionSummary.updatedAt": now,
    updatedAt: Timestamp.now(),
  });

  batch.update(subsCol().doc(rzpSubId), {
    cancelAtPeriodEnd: false,
    pendingPlanChange: FieldValue.delete(),
    updatedAt: now,
  });

  await batch.commit();

  logger.info("[razorpay-subscription] Subscription cancellation reversed", { uid, rzpSubId });

  return { resumed: true };
};

// ---------------------------------------------------------------------------
// CHANGE SUBSCRIPTION PLAN (Upgrade / Downgrade)
// ---------------------------------------------------------------------------

export const changeSubscriptionPlan = async (
  uid: string,
  newPlanId: BillingPlanIdWithCycle | string,
  scheduleChangeAt: "now" | "cycle_end" = "now"
): Promise<{
  success: boolean;
  requiresNewCheckout?: boolean;
  planId: string;
  planName: string;
  billingCycle: string;
  scheduleChangeAt: string;
}> => {
  // 1. Validate target plan
  if (newPlanId === BILLING_PLAN_IDS.FREE || newPlanId === "free") {
    throw new AppError(400, "To switch to the free plan, please use the cancel subscription or free plan endpoint.");
  }

  const newPlanDoc = await plansCol().doc(newPlanId).get();
  if (!newPlanDoc.exists) {
    throw new AppError(400, "Invalid plan. Please select a valid subscription plan.");
  }

  const newPlan = { id: newPlanDoc.id, ...newPlanDoc.data() } as SubscriptionPlan;
  if (!newPlan.active) {
    throw new AppError(400, "This plan is currently unavailable. Please select another plan.");
  }
  if (!newPlan.razorpayPlanId) {
    throw new AppError(503, "Payment configuration is incomplete for this plan. Please contact support.");
  }

  // 2. Check existing active subscription
  const userDoc = await usersCol().doc(uid).get();
  const summary = userDoc.data()?.subscriptionSummary as SubscriptionSummary | undefined;

  if (!summary || summary.status !== SUBSCRIPTION_STATUS.ACTIVE || summary.provider !== "razorpay") {
    throw new AppError(404, "No active Razorpay subscription found to upgrade or change.");
  }

  if (summary.planId === newPlanId) {
    throw new AppError(400, "You are already subscribed to this plan.");
  }

  // 2a. Guard against plan downgrades on active subscriptions
  const currentRank = getPlanTierRank(summary.planId || summary.planName);
  const targetRank = getPlanTierRank(newPlan.id || newPlan.name);
  if (targetRank < currentRank) {
    throw new AppError(
      400,
      "Downgrading to a lower plan tier is not permitted on active subscriptions. Please cancel your subscription if you want to switch to a lower plan after your billing cycle ends."
    );
  }

  // 2b. Check if billing cycle is changing (e.g. monthly -> yearly)
  // Razorpay Subscriptions API strictly forbids interval changes on existing subscription IDs.
  // When switching interval, client must trigger a fresh checkout session.
  const isCycleChanging = Boolean(
    summary.billingCycle &&
    newPlan.billingCycle &&
    summary.billingCycle !== "none" &&
    newPlan.billingCycle !== "none" &&
    summary.billingCycle !== newPlan.billingCycle
  );

  if (isCycleChanging) {
    return {
      success: false,
      requiresNewCheckout: true,
      planId: newPlan.id,
      planName: newPlan.name,
      billingCycle: newPlan.billingCycle,
      scheduleChangeAt,
    };
  }

  const rzpSubId = summary.razorpaySubscriptionId;
  if (!rzpSubId) {
    throw new AppError(500, "Subscription ID is missing. Please contact support.");
  }

  // 3. Update subscription on Razorpay
  const razorpay = getRazorpay();
  try {
    await (razorpay.subscriptions as any).update(rzpSubId, {
      plan_id: newPlan.razorpayPlanId,
      schedule_change_at: scheduleChangeAt,
      customer_notify: 1,
    });
  } catch (err: any) {
    const errorDesc = err?.error?.description || err?.message || "";
    // Razorpay Subscriptions under RBI mandate rules does not permit in-place plan/amount updates
    // for card/UPI mandates or domestic cards. Seamlessly fall back to requiring a new checkout.
    const isMandateRestriction =
      err?.statusCode === 400 ||
      err?.error?.code === "BAD_REQUEST_ERROR" ||
      errorDesc.toLowerCase().includes("mandate") ||
      errorDesc.toLowerCase().includes("domestic card") ||
      errorDesc.toLowerCase().includes("card");

    if (isMandateRestriction) {
      logger.info(
        "[razorpay-subscription] In-place plan update not permitted by Razorpay mandate rules; prompting new checkout",
        { uid, rzpSubId, newPlanId, reason: errorDesc }
      );
      return {
        success: false,
        requiresNewCheckout: true,
        planId: newPlan.id,
        planName: newPlan.name,
        billingCycle: newPlan.billingCycle,
        scheduleChangeAt,
      };
    }

    logger.error("[razorpay-subscription] Failed to update Razorpay subscription plan", {
      uid,
      rzpSubId,
      newPlanId,
      error: errorDesc,
    });
    throw new AppError(502, `Unable to change subscription plan: ${errorDesc || "Razorpay update failed"}`);
  }

  // 4. Update Firestore documents
  const now = new Date().toISOString();
  const tier = BILLING_PLAN_TO_TIER[newPlan.id as BillingPlanIdWithCycle] || "pro";
  const batch = db.batch();

  if (scheduleChangeAt === "now") {
    batch.update(subsCol().doc(rzpSubId), {
      planId: newPlan.id,
      planName: newPlan.name,
      billingCycle: newPlan.billingCycle === "none" ? "monthly" : newPlan.billingCycle,
      razorpayPlanId: newPlan.razorpayPlanId,
      amount: newPlan.amount,
      currency: newPlan.currency,
      cancelAtPeriodEnd: false,
      pendingPlanChange: FieldValue.delete(),
      updatedAt: now,
    });

    const currentMonthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    batch.update(usersCol().doc(uid), {
      "subscriptionSummary.planId": newPlan.id,
      "subscriptionSummary.planName": newPlan.name,
      "subscriptionSummary.billingCycle": newPlan.billingCycle === "none" ? "monthly" : newPlan.billingCycle,
      "subscriptionSummary.cancelAtPeriodEnd": false,
      "subscriptionSummary.pendingPlanChange": FieldValue.delete(),
      "subscriptionSummary.updatedAt": now,
      "subscription.plan": tier,
      planTier: tier,
      "stats.interviewsCreatedThisMonth": 0,
      "stats.interviewsMonthKey": currentMonthKey,
      "stats.resumeAnalysesCreatedThisMonth": 0,
      "stats.resumeAnalysesMonthKey": currentMonthKey,
      updatedAt: Timestamp.now(),
    });
  } else {
    const pendingChange = {
      planId: newPlan.id,
      planName: newPlan.name,
      billingCycle: newPlan.billingCycle === "none" ? "monthly" : newPlan.billingCycle,
      scheduledAt: now,
      effectiveAt: summary.currentPeriodEnd || undefined,
    };

    batch.update(subsCol().doc(rzpSubId), {
      pendingPlanChange: pendingChange,
      updatedAt: now,
    });

    batch.update(usersCol().doc(uid), {
      "subscriptionSummary.pendingPlanChange": pendingChange,
      "subscriptionSummary.updatedAt": now,
      updatedAt: Timestamp.now(),
    });
  }

  await batch.commit();

  logger.info("[razorpay-subscription] Subscription plan changed", {
    uid,
    rzpSubId,
    newPlanId,
    scheduleChangeAt,
  });

  return {
    success: true,
    planId: newPlan.id,
    planName: newPlan.name,
    billingCycle: newPlan.billingCycle,
    scheduleChangeAt,
  };
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
export const forceResetUserToFreePlan = async (uid: string): Promise<void> => {
  const now = new Date().toISOString();
  const freeSummary: SubscriptionSummary = {
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
      subscriptionSummary: freeSummary,
      subscription: {
        plan: PLAN_IDS.FREE,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        expiresAt: null,
        purchaseDate: now,
        interviewCredits: 3,
      },
      planTier: PLAN_IDS.FREE,
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  logger.info("[razorpay-subscription] Forcefully reset user to Free plan", { uid });
};

// ---------------------------------------------------------------------------
// ACTIVATE FREE PLAN
// ---------------------------------------------------------------------------

export const activateFreePlan = async (
  uid: string
): Promise<{ scheduledForPeriodEnd: boolean; planId: string }> => {
  const userDoc = await usersCol().doc(uid).get();
  const existingSummary = userDoc.data()?.subscriptionSummary as SubscriptionSummary | undefined;

  // -------------------------------------------------------------------------
  // Path A: Active paid Razorpay subscription → block direct downgrade to free.
  // Users must use cancelSubscription() to stop auto-renewal at period end.
  // -------------------------------------------------------------------------
  if (
    existingSummary &&
    existingSummary.provider === "razorpay" &&
    existingSummary.razorpaySubscriptionId &&
    existingSummary.status === SUBSCRIPTION_STATUS.ACTIVE &&
    getPlanTierRank(existingSummary.planId || existingSummary.planName) > 0
  ) {
    throw new AppError(
      400,
      "Downgrading an active subscription directly is not permitted. Please use the Cancel Subscription option if you wish to discontinue your paid plan at the end of your billing cycle."
    );
  }

  // -------------------------------------------------------------------------
  // Path B: No active Razorpay subscription (already free, legacy plan, or
  // cancelled subscription) — set free plan state immediately in Firestore.
  // -------------------------------------------------------------------------
  await forceResetUserToFreePlan(uid);

  return { scheduledForPeriodEnd: false, planId: "free" };
};
