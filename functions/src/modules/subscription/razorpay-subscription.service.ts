/**
 * Razorpay subscription lifecycle service.
 * Handles: create subscription, verify payment, get current, cancel, payment history.
 */

import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { createHmac } from "crypto";
import { db } from "../../config/firebase";
import { getRazorpay, getRazorpayConfig } from "../../config/razorpay";
import { BILLING_PLAN_IDS, BILLING_PLAN_TO_TIER, PLAN_IDS, SUBSCRIPTION_STATUS } from "../../constants/payment.constants";
import type { BillingPlanIdWithCycle, SubscriptionStatus } from "../../constants/payment.constants";
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
import { Request } from "express";
import { detectPaymentCurrency } from "./country-detection.service";
import { getInrPerUsdRate, convertInrToUsd } from "./currency.service";
import { resolveBillingPeriodEnd } from "../../utils/date-helpers";

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

export const getActivePlans = async (
  targetCurrency?: "INR" | "USD",
  country?: string
): Promise<PlanPublicInfo[]> => {
  const [snap, inrPerUsd] = await Promise.all([
    plansCol().where("active", "==", true).get(),
    getInrPerUsdRate(),
  ]);

  const currencyToUse: "INR" | "USD" =
    targetCurrency || (country === "IN" ? "INR" : "USD");

  return snap.docs.map((doc) => {
    const data = doc.data() as SubscriptionPlan;
    const isYearly = data.billingCycle === "yearly";

    // Standard amounts for INR
    const amountInr =
      data.amountInr ||
      (data.id === "pro_yearly"
        ? 7668
        : data.id === "elite_yearly"
        ? 19188
        : data.id === "elite_monthly"
        ? 1999
        : data.id === "free"
        ? 0
        : 799);
    const displayPriceInr =
      data.displayPriceInr || (isYearly ? Math.round(amountInr / 12) : amountInr);
    const annualAmountInr = isYearly ? amountInr : undefined;

    // Standard amounts for USD
    let amountUsd =
      data.amountUsd ||
      (data.id === "pro_yearly"
        ? 80
        : data.id === "elite_yearly"
        ? 200
        : data.id === "elite_monthly"
        ? 20.86
        : data.id === "free"
        ? 0
        : 8.34);
    let displayPriceUsd =
      data.displayPriceUsd || (isYearly ? (data.id === "elite_yearly" ? 16.67 : 6.67) : amountUsd);
    let annualAmountUsd = isYearly ? amountUsd : undefined;

    if (data.id === "free") {
      amountUsd = 0;
      displayPriceUsd = 0;
      annualAmountUsd = undefined;
    }

    const finalAmount = currencyToUse === "INR" ? amountInr : amountUsd;
    const finalDisplayPrice = currencyToUse === "INR" ? displayPriceInr : displayPriceUsd;
    const finalAnnualAmount = currencyToUse === "INR" ? annualAmountInr : annualAmountUsd;

    let finalBillingDescription = data.billingDescription;
    if (currencyToUse === "INR") {
      if (data.id === "free") {
        finalBillingDescription = "Free forever.";
      } else if (isYearly) {
        finalBillingDescription = `Billed annually at ₹${amountInr}/year (Save ${data.discountPercent || 20}%).`;
      } else {
        finalBillingDescription = "Billed monthly. Cancel anytime.";
      }
    } else {
      if (data.id === "free") {
        finalBillingDescription = "Free forever.";
      } else if (isYearly) {
        finalBillingDescription = `Billed annually at $${annualAmountUsd || 80}/year (Save ${data.discountPercent || 20}%).`;
      } else {
        finalBillingDescription = "Billed monthly. Cancel anytime.";
      }
    }

    return {
      id: data.id || doc.id,
      name: data.name,
      billingCycle: data.billingCycle,
      currency: currencyToUse,
      amount: finalAmount,
      displayPrice: finalDisplayPrice,
      displayPeriod: data.displayPeriod,
      annualAmount: finalAnnualAmount,
      discountPercent: data.discountPercent,
      description: data.description,
      billingDescription: finalBillingDescription,
      features: data.features,
      active: data.active,
      exchangeRate: inrPerUsd,
      amountInr,
      displayPriceInr,
      annualAmountInr,
      amountUsd,
      displayPriceUsd,
      annualAmountUsd,
      country,
    };
  });
};

// ---------------------------------------------------------------------------
// CREATE SUBSCRIPTION
// ---------------------------------------------------------------------------

export const createSubscription = async (
  uid: string,
  planId: BillingPlanIdWithCycle | string,
  req?: Request
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

  const existingUserDoc = await usersCol().doc(uid).get();
  const existingSummary = existingUserDoc.data()?.subscriptionSummary as SubscriptionSummary | undefined;
  const onYearlyPlan =
    existingSummary?.status === SUBSCRIPTION_STATUS.ACTIVE &&
    existingSummary.provider === "razorpay" &&
    (existingSummary.billingCycle === "yearly" || String(existingSummary.planId || "").toLowerCase().includes("yearly"));
  if (onYearlyPlan && plan.billingCycle === "monthly") {
    throw new AppError(
      400,
      "You are on a yearly plan. Monthly billing is available after this yearly period ends. You can cancel, or upgrade to a higher yearly plan."
    );
  }

  // 2. Detect country & currency via backend IP/headers (Backend is single source of truth!)
  const geo = req
    ? detectPaymentCurrency(req)
    : { country: "US", currency: "USD" as const, clientIp: "", source: "fallback" as const };
  const currency: "INR" | "USD" = geo.currency;
  const country = geo.country;

  const rzpConfig = getRazorpayConfig();
  let rzpPlanId: string | undefined;
  let chargeAmount: number;

  const isYearly = plan.billingCycle === "yearly";

  if (currency === "INR") {
    // 🇮🇳 INDIA: Use INR Razorpay Plan
    if (plan.id === "pro_monthly") {
      rzpPlanId = plan.razorpayPlanId || rzpConfig.proMonthlyPlanId;
      chargeAmount = plan.displayPriceInr || plan.amountInr || 799;
    } else if (plan.id === "pro_yearly") {
      rzpPlanId = plan.razorpayPlanId || rzpConfig.proYearlyPlanId;
      chargeAmount = plan.annualAmountInr || plan.amountInr || 7668;
    } else if (plan.id === "elite_monthly") {
      rzpPlanId = plan.razorpayPlanId || rzpConfig.eliteMonthlyPlanId;
      chargeAmount = plan.displayPriceInr || plan.amountInr || 1999;
    } else if (plan.id === "elite_yearly") {
      rzpPlanId = plan.razorpayPlanId || rzpConfig.eliteYearlyPlanId;
      chargeAmount = plan.annualAmountInr || plan.amountInr || 19188;
    } else {
      rzpPlanId = plan.razorpayPlanId;
      chargeAmount = plan.amountInr || plan.amount || 799;
    }
  } else {
    // 🌎 REST OF WORLD: Use USD Razorpay Plan (Existing USD implementation preserved intact)
    if (plan.id === "pro_monthly") {
      rzpPlanId = plan.razorpayPlanIdUsd || rzpConfig.proMonthlyPlanIdUsd || plan.razorpayPlanId;
      chargeAmount = plan.displayPriceUsd || plan.amountUsd || plan.displayPrice || 8.34;
    } else if (plan.id === "pro_yearly") {
      rzpPlanId = plan.razorpayPlanIdUsd || rzpConfig.proYearlyPlanIdUsd || plan.razorpayPlanId;
      chargeAmount = plan.annualAmountUsd || plan.amountUsd || plan.annualAmount || 80;
    } else if (plan.id === "elite_monthly") {
      rzpPlanId = plan.razorpayPlanIdUsd || rzpConfig.eliteMonthlyPlanIdUsd || plan.razorpayPlanId;
      chargeAmount = plan.displayPriceUsd || plan.amountUsd || plan.displayPrice || 20.86;
    } else if (plan.id === "elite_yearly") {
      rzpPlanId = plan.razorpayPlanIdUsd || rzpConfig.eliteYearlyPlanIdUsd || plan.razorpayPlanId;
      chargeAmount = plan.annualAmountUsd || plan.amountUsd || plan.annualAmount || 200;
    } else {
      rzpPlanId = plan.razorpayPlanIdUsd || plan.razorpayPlanId;
      chargeAmount = plan.amountUsd || plan.amount || 8.34;
    }
  }

  if (!rzpPlanId) {
    throw new AppError(
      503,
      `Razorpay recurring plan ID is not configured for plan "${plan.name || plan.id}" in ${currency}. Please check Firestore collection "plans" or document "config/razorpay".`
    );
  }

  // 3. Create Razorpay subscription
  const razorpay = getRazorpay();
  const { keyId } = rzpConfig;

  let razorpaySub: Record<string, unknown>;
  try {
    razorpaySub = await (razorpay.subscriptions as any).create({
      plan_id: rzpPlanId,
      total_count: isYearly ? 10 : 120, // max billing cycles
      quantity: 1,
      notes: {
        userId: uid,
        planId: plan.id,
        planName: plan.name,
        currency,
        country,
      },
    });
  } catch (err: any) {
    const detail = err?.error?.description || err?.message || "Razorpay API error";
    logger.error("[razorpay-subscription] Failed to create Razorpay subscription", {
      uid,
      planId,
      currency,
      country,
      rzpPlanId,
      error: detail,
    });
    throw new AppError(502, `Payment gateway error: ${detail}`);
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
    razorpayPlanId: rzpPlanId,
    planId: plan.id,
    planName: plan.name,
    billingCycle: plan.billingCycle === "none" ? "monthly" : plan.billingCycle,
    status: SUBSCRIPTION_STATUS.PENDING,
    amount: chargeAmount,
    currency,
    country,
    cancelAtPeriodEnd: false,
    createdAt: now,
    updatedAt: now,
  };

  await subsCol().doc(rzpSubId).set(subRecord);

  logger.info("[razorpay-subscription] Created pending subscription", {
    uid,
    planId,
    rzpSubId,
    currency,
    country,
  });

  return {
    subscriptionId: rzpSubId,
    keyId,
    planId: plan.id,
    planName: plan.name,
    billingCycle: plan.billingCycle === "none" ? "monthly" : plan.billingCycle,
    amount: chargeAmount,
    currency,
    country,
  };
};

// ---------------------------------------------------------------------------
// VERIFY PAYMENT
// ---------------------------------------------------------------------------

type PlanSwitchRefund = {
  amount: number;
  currency: string;
  status: "processed" | "failed";
};

/**
 * Refunds the unused share of the previous plan when a new checkout replaces it.
 * In-place Razorpay plan updates do not call this — that path is not charged twice.
 */
const refundUnusedPreviousPlan = async (
  uid: string,
  oldRzpSubId: string,
  nowIso: string
): Promise<PlanSwitchRefund | null> => {
  const oldSubDoc = await subsCol().doc(oldRzpSubId).get();
  if (!oldSubDoc.exists) return null;
  const oldSub = oldSubDoc.data() as SubscriptionRecord;

  const startIso = oldSub.currentPeriodStart;
  const endIso = resolveBillingPeriodEnd(oldSub.billingCycle, startIso, oldSub.currentPeriodEnd);
  const startMs = startIso ? new Date(startIso).getTime() : NaN;
  const endMs = endIso ? new Date(endIso).getTime() : NaN;
  const nowMs = new Date(nowIso).getTime();
  if (!startIso || !endIso || !(endMs > startMs) || nowMs >= endMs) return null;

  const remainingRatio = (endMs - nowMs) / (endMs - startMs);
  const razorpay = getRazorpay();

  let paymentId: string | undefined;
  const paySnap = await paymentsCol().where("userId", "==", uid).get();
  const captured = paySnap.docs
    .map((doc) => doc.data() as SubscriptionPaymentRecord)
    .filter(
      (payment) =>
        payment.razorpaySubscriptionId === oldRzpSubId &&
        (payment.status === "captured" || payment.status === "authorized")
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  paymentId = captured[0]?.razorpayPaymentId;

  if (!paymentId) {
    try {
      const invoices = await (razorpay.invoices as any).all({ subscription_id: oldRzpSubId });
      const paid = (invoices?.items || [])
        .filter((inv: any) => inv.payment_id && inv.status === "paid")
        .sort((a: any, b: any) => (b.paid_at || 0) - (a.paid_at || 0));
      paymentId = paid[0]?.payment_id;
    } catch (invErr: any) {
      logger.warn("[razorpay-subscription] Could not list invoices for unused-plan refund", {
        uid,
        oldRzpSubId,
        error: invErr.message,
      });
    }
  }
  if (!paymentId) return null;

  const payment = await (razorpay.payments as any).fetch(paymentId);
  const amountPaise = Number(payment?.amount) || 0;
  const alreadyRefunded = Number(payment?.amount_refunded) || 0;
  const refundable = amountPaise - alreadyRefunded;
  const currency = String(payment?.currency || oldSub.currency || "INR");
  let refundPaise = Math.floor(refundable * remainingRatio);
  if (refundPaise > refundable) refundPaise = refundable;
  if (refundPaise < 100) return null;

  const refund = await (razorpay.payments as any).refund(paymentId, {
    amount: refundPaise,
    speed: "normal",
    notes: {
      reason: "unused_amount_on_plan_switch",
      userId: uid,
      oldSubscriptionId: oldRzpSubId,
    },
  });

  await paymentsCol().doc(paymentId).set(
    {
      userId: uid,
      razorpayPaymentId: paymentId,
      razorpaySubscriptionId: oldRzpSubId,
      status: refundPaise >= refundable ? "refunded" : "partially_refunded",
      refundedAmount: (alreadyRefunded + refundPaise) / 100,
      razorpayRefundId: refund?.id,
      currency,
      updatedAt: nowIso,
    },
    { merge: true }
  );

  logger.info("[razorpay-subscription] Refunded unused amount from previous plan", {
    uid,
    oldRzpSubId,
    paymentId,
    refundPaise,
    currency,
  });

  return { amount: refundPaise / 100, currency, status: "processed" };
};

export const verifyPayment = async (
  uid: string,
  input: VerifyPaymentInput
): Promise<{ verified: boolean; subscriptionId: string; refund?: PlanSwitchRefund | null }> => {
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
  const periodEnd =
    resolveBillingPeriodEnd(subData.billingCycle, now) ||
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Activate subscription record in Firestore
  await subsCol().doc(razorpaySubscriptionId).update({
    status: SUBSCRIPTION_STATUS.ACTIVE,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    updatedAt: now,
  });

  // 1a. If user already had a different active Razorpay subscription, refund unused time and cancel it
  // so they are not double-billed. In-place plan updates never reach this path.
  const existingUserDoc = await usersCol().doc(uid).get();
  const existingSummary = existingUserDoc.data()?.subscriptionSummary as SubscriptionSummary | undefined;
  let switchRefund: PlanSwitchRefund | null = null;
  if (
    existingSummary &&
    existingSummary.status === SUBSCRIPTION_STATUS.ACTIVE &&
    existingSummary.razorpaySubscriptionId &&
    existingSummary.razorpaySubscriptionId !== razorpaySubscriptionId
  ) {
    const oldRzpSubId = existingSummary.razorpaySubscriptionId;
    try {
      switchRefund = await refundUnusedPreviousPlan(uid, oldRzpSubId, now);
    } catch (refundErr: any) {
      logger.error("[razorpay-subscription] Unused-plan refund failed", {
        uid,
        oldRzpSubId,
        error: refundErr.message,
      });
      switchRefund = {
        amount: 0,
        currency: existingSummary.currency || "INR",
        status: "failed",
      };
    }
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
  const cycleKey = `cycle_${now.slice(0, 10)}`;

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
        currency: subData.currency,
        country: subData.country,
        amount: subData.amount,
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
        interviewsMonthKey: cycleKey,
        resumeAnalysesCreatedThisMonth: 0,
        resumeAnalysesMonthKey: cycleKey,
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
    country: subData.country,
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

  return { verified: true, subscriptionId: razorpaySubscriptionId, refund: switchRefund };
};

// ---------------------------------------------------------------------------
// SYNC USER SUBSCRIPTION WITH RAZORPAY (Self-Healing)
// ---------------------------------------------------------------------------

export type SubscriptionSyncResult =
  | { outcome: "active"; summary: SubscriptionSummary }
  | { outcome: "keep"; summary?: SubscriptionSummary }
  | { outcome: "none" };

const mapRazorpayStatus = (status: string): SubscriptionStatus => {
  if (status === "active" || status === "authenticated") return SUBSCRIPTION_STATUS.ACTIVE;
  if (status === "pending") return SUBSCRIPTION_STATUS.PENDING;
  if (status === "halted") return SUBSCRIPTION_STATUS.HALTED;
  if (status === "cancelled") return SUBSCRIPTION_STATUS.CANCELLED;
  if (status === "completed") return SUBSCRIPTION_STATUS.COMPLETED;
  return SUBSCRIPTION_STATUS.EXPIRED;
};

/**
 * Writes the Razorpay subscription onto the user as the current paid plan.
 * Used both when the cycle is current and when a renewal charge is still in flight.
 */
const persistRazorpaySummary = async (
  uid: string,
  docId: string,
  subRecord: SubscriptionRecord,
  rzpSub: any,
  summaryStatus: SubscriptionStatus
): Promise<SubscriptionSummary> => {
  const now = new Date().toISOString();
  const currentPeriodStart = rzpSub.current_start
    ? new Date(rzpSub.current_start * 1000).toISOString()
    : subRecord.currentPeriodStart || now;
  const gatewayPeriodEnd = rzpSub.current_end
    ? new Date(rzpSub.current_end * 1000).toISOString()
    : subRecord.currentPeriodEnd;
  const currentPeriodEnd = resolveBillingPeriodEnd(
    subRecord.billingCycle,
    currentPeriodStart,
    gatewayPeriodEnd,
  );
  const planId = subRecord.planId || rzpSub.notes?.planId || "pro_monthly";
  const planName = subRecord.planName || rzpSub.notes?.planName || "Pro";
  const tier = BILLING_PLAN_TO_TIER[planId as BillingPlanIdWithCycle] || "pro";

  const summary: SubscriptionSummary = {
    planId,
    planName,
    billingCycle: subRecord.billingCycle || "monthly",
    status: summaryStatus,
    provider: "razorpay",
    razorpaySubscriptionId: subRecord.razorpaySubscriptionId,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(rzpSub.cancel_at_cycle_end),
    ...(subRecord.currency ? { currency: subRecord.currency } : {}),
    ...(subRecord.country ? { country: subRecord.country } : {}),
    ...(typeof subRecord.amount === "number" ? { amount: subRecord.amount } : {}),
    updatedAt: now,
  };

  await subsCol().doc(docId).update({
    status: summaryStatus,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(rzpSub.cancel_at_cycle_end),
    ...(rzpSub.customer_id ? { razorpayCustomerId: String(rzpSub.customer_id) } : {}),
    updatedAt: now,
  });

  await usersCol().doc(uid).set(
    {
      subscriptionSummary: summary,
      subscription: {
        plan: tier,
        status: summaryStatus,
        expiresAt: currentPeriodEnd || null,
        purchaseDate: subRecord.createdAt || now,
        interviewCredits: -1,
      },
      planTier: tier,
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  return summary;
};

export const syncUserSubscriptionWithRazorpay = async (
  uid: string
): Promise<SubscriptionSyncResult> => {
  let sawUnconfirmed = false;

  try {
    const razorpay = getRazorpay();
    const subsSnap = await subsCol().where("userId", "==", uid).get();
    if (subsSnap.empty) return { outcome: "none" };

    // Check subscriptions sorted newest first
    const sortedDocs = [...subsSnap.docs].sort((a, b) => {
      const timeA = new Date(a.data().createdAt || 0).getTime();
      const timeB = new Date(b.data().createdAt || 0).getTime();
      return timeB - timeA;
    });

    for (const doc of sortedDocs) {
      const subRecord = doc.data() as SubscriptionRecord;
      if (!subRecord.razorpaySubscriptionId) continue;

      let rzpSub: any;
      try {
        rzpSub = await (razorpay.subscriptions as any).fetch(subRecord.razorpaySubscriptionId);
      } catch (err: any) {
        sawUnconfirmed = true;
        logger.warn("[razorpay-subscription] Error fetching sub from Razorpay during sync", {
          subscriptionId: subRecord.razorpaySubscriptionId,
          error: err.message,
        });
        continue;
      }
      if (!rzpSub) continue;

      const now = new Date().toISOString();
      const nowMs = Date.now();
      const currentPeriodEndMs = rzpSub.current_end ? rzpSub.current_end * 1000 : undefined;
      const isCycleEnded = currentPeriodEndMs !== undefined ? currentPeriodEndMs < nowMs : false;
      const rzpStatus = String(rzpSub.status || "");

      const isTerminal =
        rzpStatus === "completed" ||
        rzpStatus === "cancelled" ||
        rzpStatus === "expired" ||
        (rzpStatus === "halted" && isCycleEnded);

      if (isTerminal) {
        const periodStart = rzpSub.current_start
          ? new Date(rzpSub.current_start * 1000).toISOString()
          : subRecord.currentPeriodStart;
        const gatewayEnd = rzpSub.current_end
          ? new Date(rzpSub.current_end * 1000).toISOString()
          : subRecord.currentPeriodEnd;
        const paidThrough = resolveBillingPeriodEnd(subRecord.billingCycle, periodStart, gatewayEnd);
        const paidThroughMs = paidThrough ? new Date(paidThrough).getTime() : NaN;
        // A cancelled yearly plan keeps the year already paid for, even if Razorpay's cycle is shorter.
        if (subRecord.billingCycle === "yearly" && !isNaN(paidThroughMs) && paidThroughMs > nowMs) {
          const markCancel = rzpStatus === "cancelled" || rzpStatus === "expired";
          const kept = await persistRazorpaySummary(
            uid,
            doc.id,
            { ...subRecord, currentPeriodStart: periodStart, currentPeriodEnd: paidThrough },
            { ...rzpSub, current_end: Math.floor(paidThroughMs / 1000), cancel_at_cycle_end: markCancel },
            SUBSCRIPTION_STATUS.ACTIVE,
          );
          return { outcome: "keep", summary: { ...kept, cancelAtPeriodEnd: true, currentPeriodEnd: paidThrough } };
        }

        await subsCol().doc(doc.id).update({
          status: mapRazorpayStatus(rzpStatus),
          cancelAtPeriodEnd: false,
          updatedAt: now,
        });
        continue;
      }

      const renewalInFlight =
        (rzpStatus === "active" || rzpStatus === "authenticated" || rzpStatus === "pending") &&
        isCycleEnded;
      const haltedWithinPeriod = rzpStatus === "halted" && !isCycleEnded;
      const billingCurrent =
        (rzpStatus === "active" || rzpStatus === "authenticated") && !isCycleEnded;

      if (!billingCurrent && !renewalInFlight && !haltedWithinPeriod && rzpStatus !== "pending") {
        continue;
      }

      const summaryStatus = mapRazorpayStatus(rzpStatus);
      const summary = await persistRazorpaySummary(uid, doc.id, subRecord, rzpSub, summaryStatus);

      if (billingCurrent) {
        try {
          const invoices = await (razorpay.invoices as any).all({
            subscription_id: subRecord.razorpaySubscriptionId,
          });
          if (invoices?.items) {
            for (const inv of invoices.items) {
              if (inv.payment_id && (inv.status === "paid" || inv.status === "issued")) {
                const paymentRecord: SubscriptionPaymentRecord = {
                  userId: uid,
                  razorpayPaymentId: inv.payment_id,
                  razorpaySubscriptionId: subRecord.razorpaySubscriptionId,
                  planId: summary.planId,
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
          planId: summary.planId,
        });
        return { outcome: "active", summary };
      }

      logger.info("[razorpay-subscription] Renewal still in flight — keeping paid plan", {
        uid,
        subscriptionId: subRecord.razorpaySubscriptionId,
        rzpStatus,
        isCycleEnded,
      });
      return { outcome: "keep", summary };
    }
  } catch (err: any) {
    logger.warn("[razorpay-subscription] Error during subscription sync", {
      uid,
      error: err.message,
    });
    return { outcome: "keep" };
  }

  return sawUnconfirmed ? { outcome: "keep" } : { outcome: "none" };
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
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  provider: string;
  razorpaySubscriptionId?: string;
  pendingPlanChange?: any;
}> => {
  const userDoc = await usersCol().doc(uid).get();
  const userData = userDoc.data();
  let summary = userData?.subscriptionSummary as SubscriptionSummary | undefined;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString();
  const nextMonthReset = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0).toISOString();

  const freeResponse = () => ({
    planId: "free",
    planName: "Free",
    status: SUBSCRIPTION_STATUS.ACTIVE,
    billingCycle: "none",
    currentPeriodStart: monthStart,
    currentPeriodEnd: nextMonthReset,
    cancelAtPeriodEnd: false,
    provider: "none" as const,
  });

  const keepsPaidAccess = (candidate?: SubscriptionSummary): boolean => {
    if (!candidate) return false;
    if (candidate.planId === PLAN_IDS.FREE || candidate.planId === "free") return false;
    if (
      candidate.status === SUBSCRIPTION_STATUS.ACTIVE ||
      candidate.status === SUBSCRIPTION_STATUS.PENDING
    ) {
      return true;
    }
    if (candidate.status === SUBSCRIPTION_STATUS.HALTED && candidate.currentPeriodEnd) {
      const endMs = new Date(candidate.currentPeriodEnd).getTime();
      return !isNaN(endMs) && endMs >= Date.now();
    }
    return false;
  };

  // 1a. Free plan with no Razorpay id does not need a gateway lookup.
  // A leftover Razorpay id means a previous downgrade may have raced a renewal — recover it.
  if (
    summary &&
    (summary.planId === PLAN_IDS.FREE || summary.planId === "free") &&
    summary.provider === "none"
  ) {
    if (!summary.razorpaySubscriptionId) {
      return freeResponse();
    }

    const recovered = await syncUserSubscriptionWithRazorpay(uid);
    if (recovered.outcome !== "none" && recovered.summary && keepsPaidAccess(recovered.summary)) {
      summary = recovered.summary;
    } else if (recovered.outcome === "none") {
      await usersCol()
        .doc(uid)
        .update({ "subscriptionSummary.razorpaySubscriptionId": FieldValue.delete() })
        .catch(() => undefined);
      return freeResponse();
    } else {
      return freeResponse();
    }
  }

  // 1b. If paid summary period has expired, sync with Razorpay.
  // Active, authenticated, or pending means the renewal is still in flight — do not downgrade.
  if (
    summary &&
    summary.currentPeriodEnd &&
    summary.planId !== PLAN_IDS.FREE &&
    summary.planId !== "free"
  ) {
    const periodEndMs = new Date(summary.currentPeriodEnd).getTime();
    if (!isNaN(periodEndMs) && periodEndMs < Date.now()) {
      const synced = await syncUserSubscriptionWithRazorpay(uid);
      if (synced.outcome !== "none" && synced.summary && keepsPaidAccess(synced.summary)) {
        summary = synced.summary;
      } else if (synced.outcome === "keep") {
        // Razorpay could not be confirmed. Leave the paid plan in place.
      } else {
        await forceResetUserToFreePlan(uid);
        return freeResponse();
      }
    }
  }

  // 1c. Pending or halted paid plans: sync, but do not wipe a plan Razorpay has not ended.
  if (!keepsPaidAccess(summary)) {
    const synced = await syncUserSubscriptionWithRazorpay(uid);
    if (synced.outcome !== "none" && synced.summary && keepsPaidAccess(synced.summary)) {
      summary = synced.summary;
    }
  }

  // 2. Check legacy subscription field if still not entitled
  if (!keepsPaidAccess(summary)) {
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

    await forceResetUserToFreePlan(uid);
    return freeResponse();
  }

  return {
    planId: summary!.planId,
    planName: summary!.planName,
    status: summary!.status,
    billingCycle: summary!.billingCycle,
    currentPeriodStart: summary!.currentPeriodStart,
    currentPeriodEnd: summary!.currentPeriodEnd,
    cancelAtPeriodEnd: summary!.cancelAtPeriodEnd,
    provider: summary!.provider,
    razorpaySubscriptionId: summary!.razorpaySubscriptionId,
    pendingPlanChange: summary!.pendingPlanChange || null,
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

  const currentIsYearly =
    summary.billingCycle === "yearly" || String(summary.planId || "").toLowerCase().includes("yearly");
  if (currentIsYearly && newPlan.billingCycle === "monthly") {
    throw new AppError(
      400,
      "You are on a yearly plan. Monthly billing is available after this yearly period ends. You can cancel, or upgrade to a higher yearly plan."
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
  const existingSubDoc = await subsCol().doc(rzpSubId).get();
  const isUsd = existingSubDoc.exists && (existingSubDoc.data() as SubscriptionRecord).currency === "USD";
  const targetPlanId = isUsd && newPlan.razorpayPlanIdUsd ? newPlan.razorpayPlanIdUsd : newPlan.razorpayPlanId;

  try {
    await (razorpay.subscriptions as any).update(rzpSubId, {
      plan_id: targetPlanId,
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
    const isYearly = newPlan.billingCycle === "yearly";
    const targetAmount = isUsd
      ? (isYearly ? (newPlan.annualAmountUsd || newPlan.amountUsd) : (newPlan.displayPriceUsd || newPlan.amountUsd)) || newPlan.amount || 8.34
      : (isYearly ? (newPlan.annualAmountInr || newPlan.amountInr) : (newPlan.displayPriceInr || newPlan.amountInr)) || newPlan.amount || 799;
    const targetCurrency = isUsd ? "USD" : "INR";

    batch.update(subsCol().doc(rzpSubId), {
      planId: newPlan.id,
      planName: newPlan.name,
      billingCycle: newPlan.billingCycle === "none" ? "monthly" : newPlan.billingCycle,
      razorpayPlanId: targetPlanId,
      amount: targetAmount,
      currency: targetCurrency,
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
      "subscriptionSummary.currency": targetCurrency,
      "subscriptionSummary.amount": targetAmount,
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
      subscriptionSummary: {
        ...freeSummary,
        razorpaySubscriptionId: FieldValue.delete(),
        razorpayCustomerId: FieldValue.delete(),
        currentPeriodStart: FieldValue.delete(),
        currentPeriodEnd: FieldValue.delete(),
        pendingPlanChange: FieldValue.delete(),
        currency: FieldValue.delete(),
        country: FieldValue.delete(),
        amount: FieldValue.delete(),
      },
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
