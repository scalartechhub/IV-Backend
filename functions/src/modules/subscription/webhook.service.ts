/**
 * Razorpay webhook event processor.
 * Handles signature validation, idempotency, and event dispatch.
 */

import { createHmac } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../../config/firebase";
import { getRazorpayConfig } from "../../config/razorpay";
import {
  BILLING_PLAN_TO_TIER,
  SUBSCRIPTION_STATUS,
} from "../../constants/payment.constants";
import type { BillingPlanIdWithCycle } from "../../constants/payment.constants";
import { COLLECTIONS } from "../../shared/constants";
import { AppError } from "../../shared/utils";
import { logger } from "../../shared/logger";
import { resolveAnniversaryQuotaPeriod, resolveBillingPeriodEnd } from "../../utils/date-helpers";
import type {
  RazorpayEventRecord,
  SubscriptionPaymentRecord,
  SubscriptionRecord,
  SubscriptionSummary,
} from "../payment/payment.model";

// ---------------------------------------------------------------------------
// COLLECTIONS
// ---------------------------------------------------------------------------
const eventsCol = () => db.collection(COLLECTIONS.RAZORPAY_EVENTS);
const subsCol = () => db.collection(COLLECTIONS.SUBSCRIPTIONS);
const paymentsCol = () => db.collection(COLLECTIONS.PAYMENTS);
const usersCol = () => db.collection(COLLECTIONS.USERS);

// ---------------------------------------------------------------------------
// MAIN ENTRY POINT
// ---------------------------------------------------------------------------

export const handleWebhookEvent = async (
  rawBody: Buffer,
  signature: string | undefined
): Promise<void> => {
  // 1. Validate signature
  const { webhookSecret } = getRazorpayConfig();
  if (!webhookSecret) {
    throw new AppError(
      503,
      'Razorpay webhook secret is not configured. Please set "webhookSecret" in Firestore collection "config", document "razorpay".'
    );
  }

  if (!signature) {
    throw new AppError(400, "Missing X-Razorpay-Signature header.");
  }

  const expectedSignature = createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  if (expectedSignature !== signature) {
    logger.warn("[webhook] Invalid signature");
    throw new AppError(400, "Invalid webhook signature.");
  }

  // 2. Parse payload
  const payload = JSON.parse(rawBody.toString("utf-8"));
  const eventName: string = payload.event;
  const eventId: string = payload.event_id || `${eventName}_${Date.now()}`;

  logger.info("[webhook] Received event", { eventName, eventId });

  // 3. Idempotency check
  const eventRef = eventsCol().doc(eventId);
  const eventDoc = await eventRef.get();

  if (eventDoc.exists && (eventDoc.data() as RazorpayEventRecord).processed) {
    logger.info("[webhook] Duplicate event — skipping", { eventId });
    return; // Already processed; return 200
  }

  // 4. Create event record (mark as processing)
  const now = new Date().toISOString();
  await eventRef.set({
    eventId,
    event: eventName,
    processed: false,
    createdAt: now,
  } satisfies RazorpayEventRecord);

  // 5. Dispatch to handler
  try {
    await dispatchEvent(eventName, payload);

    // 6. Mark as processed
    await eventRef.update({ processed: true, processedAt: new Date().toISOString() });
    logger.info("[webhook] Event processed", { eventName, eventId });
  } catch (err: any) {
    logger.error("[webhook] Event processing failed", {
      eventName,
      eventId,
      error: err.message,
    });
    // Still mark as processed to prevent infinite retries on logic errors.
    // Razorpay retries on non-2xx, so we only throw for truly transient failures.
    await eventRef.update({ processed: true, processedAt: new Date().toISOString() });
    throw err;
  }
};

// ---------------------------------------------------------------------------
// EVENT DISPATCHER
// ---------------------------------------------------------------------------

const dispatchEvent = async (eventName: string, payload: any): Promise<void> => {
  switch (eventName) {
    case "subscription.authenticated":
    case "subscription.activated":
      await handleSubscriptionActivated(payload);
      break;
    case "subscription.charged":
      await handleSubscriptionCharged(payload);
      break;
    case "subscription.pending":
      await handleSubscriptionPending(payload);
      break;
    case "subscription.halted":
      await handleSubscriptionHalted(payload);
      break;
    case "subscription.updated":
      await handleSubscriptionUpdated(payload);
      break;
    case "subscription.cancelled":
      await handleSubscriptionCancelled(payload);
      break;
    case "subscription.completed":
    case "subscription.expired":
      await handleSubscriptionExpired(payload);
      break;
    case "payment.captured":
      await handlePaymentCaptured(payload);
      break;
    case "payment.failed":
      await handlePaymentFailed(payload);
      break;
    case "payment.refunded":
    case "refund.processed":
    case "refund.created":
      await handlePaymentRefunded(payload);
      break;
    case "order.paid":
      // Usually handled via subscription.charged / payment.captured
      logger.info("[webhook] order.paid received — no additional action needed");
      break;
    default:
      logger.info("[webhook] Unhandled event type", { eventName });
  }
};

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

const extractSubscriptionEntity = (payload: any): any => {
  return payload?.payload?.subscription?.entity || {};
};

const extractPaymentEntity = (payload: any): any => {
  return payload?.payload?.payment?.entity || {};
};

const resolveUserIdFromSubscription = async (rzpSubId: string): Promise<string | null> => {
  const subDoc = await subsCol().doc(rzpSubId).get();
  if (!subDoc.exists) return null;
  return (subDoc.data() as SubscriptionRecord).userId || null;
};

const updateSubscriptionAndUser = async (
  rzpSubId: string,
  uid: string,
  subUpdates: Partial<SubscriptionRecord>,
  summaryUpdates: Partial<SubscriptionSummary>
): Promise<void> => {
  const now = new Date().toISOString();
  const batch = db.batch();

  batch.update(subsCol().doc(rzpSubId), {
    ...subUpdates,
    updatedAt: now,
  });

  batch.update(usersCol().doc(uid), {
    ...Object.fromEntries(
      Object.entries({ ...summaryUpdates, updatedAt: now })
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => [`subscriptionSummary.${k}`, v])
    ),
    updatedAt: Timestamp.now(),
  });

  await batch.commit();
};

// ---------------------------------------------------------------------------
// HANDLERS
// ---------------------------------------------------------------------------

const handleSubscriptionActivated = async (payload: any): Promise<void> => {
  const subEntity = extractSubscriptionEntity(payload);
  const rzpSubId = subEntity.id;
  if (!rzpSubId) return;

  const uid = subEntity.notes?.userId || (await resolveUserIdFromSubscription(rzpSubId));
  if (!uid) {
    logger.warn("[webhook] subscription.activated — user not found", { rzpSubId });
    return;
  }

  // Read our subscription doc for plan info
  const subDoc = await subsCol().doc(rzpSubId).get();
  const subData = subDoc.exists ? (subDoc.data() as SubscriptionRecord) : null;

  const currentPeriodStart = subEntity.current_start
    ? new Date(subEntity.current_start * 1000).toISOString()
    : undefined;
  const gatewayPeriodEnd = subEntity.current_end
    ? new Date(subEntity.current_end * 1000).toISOString()
    : undefined;
  const currentPeriodEnd = resolveBillingPeriodEnd(
    subData?.billingCycle,
    currentPeriodStart,
    gatewayPeriodEnd,
  );

  await updateSubscriptionAndUser(
    rzpSubId,
    uid,
    {
      status: SUBSCRIPTION_STATUS.ACTIVE,
      currentPeriodStart,
      currentPeriodEnd,
      razorpayCustomerId: subEntity.customer_id ? String(subEntity.customer_id) : undefined,
    },
    {
      planId: subData?.planId || subEntity.notes?.planId || "unknown",
      planName: subData?.planName || subEntity.notes?.planName || "Unknown",
      billingCycle: subData?.billingCycle || "monthly",
      status: SUBSCRIPTION_STATUS.ACTIVE,
      provider: "razorpay",
      razorpaySubscriptionId: rzpSubId,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
    }
  );

  // Also update legacy subscription field for backward compat
  const planId = subData?.planId || "pro_monthly";
  const tier = BILLING_PLAN_TO_TIER[planId as BillingPlanIdWithCycle] || "pro";
  await usersCol().doc(uid).set(
    {
      subscription: {
        plan: tier,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        expiresAt: currentPeriodEnd || null,
        purchaseDate: new Date().toISOString(),
        interviewCredits: -1,
      },
    },
    { merge: true }
  );

  logger.info("[webhook] Subscription activated", { uid, rzpSubId, planId });
};

const handleSubscriptionCharged = async (payload: any): Promise<void> => {
  const subEntity = extractSubscriptionEntity(payload);
  const rzpSubId = subEntity.id;
  if (!rzpSubId) return;

  const uid = subEntity.notes?.userId || (await resolveUserIdFromSubscription(rzpSubId));
  if (!uid) return;

  const subDoc = await subsCol().doc(rzpSubId).get();
  const subData = subDoc.exists ? (subDoc.data() as SubscriptionRecord) : null;
  const planId = subData?.planId || subEntity.notes?.planId;
  const planName = subData?.planName || subEntity.notes?.planName;
  const billingCycle = subData?.billingCycle || "monthly";
  const tier = planId ? BILLING_PLAN_TO_TIER[planId as BillingPlanIdWithCycle] || "pro" : undefined;

  const currentPeriodStart = subEntity.current_start
    ? new Date(subEntity.current_start * 1000).toISOString()
    : subData?.currentPeriodStart;
  const gatewayPeriodEnd = subEntity.current_end
    ? new Date(subEntity.current_end * 1000).toISOString()
    : undefined;
  const currentPeriodEnd = resolveBillingPeriodEnd(billingCycle, currentPeriodStart, gatewayPeriodEnd);

  await updateSubscriptionAndUser(
    rzpSubId,
    uid,
    {
      status: SUBSCRIPTION_STATUS.ACTIVE,
      currentPeriodStart,
      currentPeriodEnd,
    },
    {
      status: SUBSCRIPTION_STATUS.ACTIVE,
      provider: "razorpay",
      razorpaySubscriptionId: rzpSubId,
      ...(planId ? { planId } : {}),
      ...(planName ? { planName } : {}),
      billingCycle,
      currentPeriodStart,
      currentPeriodEnd,
      ...(subEntity.cancel_at_cycle_end !== undefined
        ? { cancelAtPeriodEnd: Boolean(subEntity.cancel_at_cycle_end) }
        : {}),
    }
  );

  // Monthly plans reset on the Razorpay cycle. Yearly plans reset on the purchase-day month.
  const cycleAnchor = currentPeriodStart || new Date().toISOString();
  const cycleKey =
    billingCycle === "yearly"
      ? resolveAnniversaryQuotaPeriod(cycleAnchor).key
      : `cycle_${cycleAnchor.slice(0, 10)}`;
  try {
    await usersCol().doc(uid).set(
      {
        ...(tier
          ? {
              planTier: tier,
              subscription: {
                plan: tier,
                status: SUBSCRIPTION_STATUS.ACTIVE,
                expiresAt: currentPeriodEnd || null,
              },
            }
          : currentPeriodEnd
            ? {
                subscription: {
                  status: SUBSCRIPTION_STATUS.ACTIVE,
                  expiresAt: currentPeriodEnd,
                },
              }
            : {}),
        ...(currentPeriodStart
          ? {
              stats: {
                interviewsCreatedThisMonth: 0,
                interviewsMonthKey: cycleKey,
                resumeAnalysesCreatedThisMonth: 0,
                resumeAnalysesMonthKey: cycleKey,
              },
            }
          : {}),
      },
      { merge: true }
    );
  } catch (statsErr: any) {
    logger.warn("[webhook] Failed to restore plan and reset usage on subscription.charged", {
      uid,
      rzpSubId,
      error: statsErr.message,
    });
  }

  logger.info("[webhook] Subscription charged (renewed) — paid plan restored", { uid, rzpSubId, planId });
};

const handleSubscriptionPending = async (payload: any): Promise<void> => {
  const subEntity = extractSubscriptionEntity(payload);
  const rzpSubId = subEntity.id;
  if (!rzpSubId) return;

  const uid = subEntity.notes?.userId || (await resolveUserIdFromSubscription(rzpSubId));
  if (!uid) return;

  // subscription.pending means payment is awaiting bank confirmation.
  // We set status=pending but do NOT revoke access — the user may still be charged successfully.
  await updateSubscriptionAndUser(
    rzpSubId,
    uid,
    { status: SUBSCRIPTION_STATUS.PENDING },
    { status: SUBSCRIPTION_STATUS.PENDING }
  );

  logger.info("[webhook] Subscription pending (awaiting payment confirmation)", { uid, rzpSubId });
};

const handleSubscriptionUpdated = async (payload: any): Promise<void> => {
  const subEntity = extractSubscriptionEntity(payload);
  const rzpSubId = subEntity.id;
  if (!rzpSubId) return;

  const uid = subEntity.notes?.userId || (await resolveUserIdFromSubscription(rzpSubId));
  if (!uid) return;

  const subDoc = await subsCol().doc(rzpSubId).get();
  const subData = subDoc.exists ? (subDoc.data() as SubscriptionRecord) : null;
  const billingCycle = subData?.billingCycle || "monthly";
  const periodStart = subEntity.current_start
    ? new Date(subEntity.current_start * 1000).toISOString()
    : subData?.currentPeriodStart;
  const gatewayEnd = subEntity.current_end
    ? new Date(subEntity.current_end * 1000).toISOString()
    : undefined;
  const currentPeriodEnd = resolveBillingPeriodEnd(billingCycle, periodStart, gatewayEnd);
  const cancelAtPeriodEnd = Boolean(subEntity.cancel_at_cycle_end);

  await updateSubscriptionAndUser(
    rzpSubId,
    uid,
    {
      cancelAtPeriodEnd,
      ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
    },
    {
      cancelAtPeriodEnd,
      ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
    }
  );

  logger.info("[webhook] Subscription updated", { uid, rzpSubId, cancelAtPeriodEnd });
};

/** Keeps a cancelled yearly plan active until one year from its start. */
const retainYearlyAccess = async (
  rzpSubId: string,
  uid: string,
  subEntity: any,
  markCancel: boolean,
): Promise<boolean> => {
  const subDoc = await subsCol().doc(rzpSubId).get();
  const subData = subDoc.exists ? (subDoc.data() as SubscriptionRecord) : null;
  const billingCycle = subData?.billingCycle;
  if (billingCycle !== "yearly") return false;

  const periodStart = subEntity.current_start
    ? new Date(subEntity.current_start * 1000).toISOString()
    : subData?.currentPeriodStart;
  const gatewayEnd = subEntity.current_end
    ? new Date(subEntity.current_end * 1000).toISOString()
    : subData?.currentPeriodEnd;
  const paidThrough = resolveBillingPeriodEnd("yearly", periodStart, gatewayEnd);
  if (!paidThrough || new Date(paidThrough).getTime() <= Date.now()) return false;

  await updateSubscriptionAndUser(
    rzpSubId,
    uid,
    {
      status: SUBSCRIPTION_STATUS.ACTIVE,
      currentPeriodStart: periodStart,
      currentPeriodEnd: paidThrough,
      cancelAtPeriodEnd: markCancel,
    },
    {
      status: SUBSCRIPTION_STATUS.ACTIVE,
      provider: "razorpay",
      ...(subData?.planId ? { planId: subData.planId } : {}),
      ...(subData?.planName ? { planName: subData.planName } : {}),
      billingCycle: "yearly",
      razorpaySubscriptionId: rzpSubId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: paidThrough,
      cancelAtPeriodEnd: markCancel,
    },
  );

  const tier = subData?.planId
    ? BILLING_PLAN_TO_TIER[subData.planId as BillingPlanIdWithCycle] || "pro"
    : "pro";
  await usersCol().doc(uid).set(
    {
      planTier: tier,
      subscription: {
        plan: tier,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        expiresAt: paidThrough,
      },
    },
    { merge: true },
  );
  return true;
};

const handleSubscriptionHalted = async (payload: any): Promise<void> => {
  const subEntity = extractSubscriptionEntity(payload);
  const rzpSubId = subEntity.id;
  if (!rzpSubId) return;

  const uid = subEntity.notes?.userId || (await resolveUserIdFromSubscription(rzpSubId));
  if (!uid) return;

  if (await retainYearlyAccess(rzpSubId, uid, subEntity, false)) {
    logger.info("[webhook] Yearly plan halted — paid year kept", { uid, rzpSubId });
    return;
  }

  const nowMs = Date.now();
  const currentPeriodEndMs = subEntity.current_end ? subEntity.current_end * 1000 : undefined;
  const isPeriodEnded = currentPeriodEndMs !== undefined ? currentPeriodEndMs <= nowMs : true;

  if (isPeriodEnded) {
    const now = new Date().toISOString();
    const batch = db.batch();
    batch.update(subsCol().doc(rzpSubId), {
      status: SUBSCRIPTION_STATUS.HALTED,
      cancelAtPeriodEnd: false,
      updatedAt: now,
    });
    batch.set(
      usersCol().doc(uid),
      {
        subscriptionSummary: {
          planId: "free",
          planName: "Free",
          billingCycle: "none",
          status: SUBSCRIPTION_STATUS.ACTIVE,
          provider: "none",
          cancelAtPeriodEnd: false,
          razorpaySubscriptionId: FieldValue.delete(),
          currentPeriodStart: FieldValue.delete(),
          currentPeriodEnd: FieldValue.delete(),
          updatedAt: now,
        },
        subscription: {
          plan: "free",
          status: SUBSCRIPTION_STATUS.ACTIVE,
          expiresAt: null,
          interviewCredits: 3,
        },
        planTier: "free",
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
    await batch.commit();
    logger.info("[webhook] Subscription halted and period ended — user downgraded to free", { uid, rzpSubId });
  } else {
    await updateSubscriptionAndUser(
      rzpSubId,
      uid,
      { status: SUBSCRIPTION_STATUS.HALTED },
      { status: SUBSCRIPTION_STATUS.HALTED }
    );
    logger.info("[webhook] Subscription halted within period", { uid, rzpSubId });
  }
};

const handleSubscriptionCancelled = async (payload: any): Promise<void> => {
  const subEntity = extractSubscriptionEntity(payload);
  const rzpSubId = subEntity.id;
  if (!rzpSubId) return;

  const uid = subEntity.notes?.userId || (await resolveUserIdFromSubscription(rzpSubId));
  if (!uid) return;

  if (await retainYearlyAccess(rzpSubId, uid, subEntity, true)) {
    logger.info("[webhook] Yearly plan cancelled at gateway — paid year kept", { uid, rzpSubId });
    return;
  }

  const now = new Date().toISOString();
  const batch = db.batch();

  // Mark subscription record as cancelled (cancelAtPeriodEnd=false — period has ended, nothing pending)
  batch.update(subsCol().doc(rzpSubId), {
    status: SUBSCRIPTION_STATUS.CANCELLED,
    cancelAtPeriodEnd: false,
    updatedAt: now,
  });

  // Fully reset subscriptionSummary to free plan state so getCurrentSubscription
  // doesn't fall into the self-healing Razorpay sync path on every subsequent call.
  batch.set(
    usersCol().doc(uid),
    {
      subscriptionSummary: {
        planId: "free",
        planName: "Free",
        billingCycle: "none",
        status: SUBSCRIPTION_STATUS.ACTIVE,
        provider: "none",
        cancelAtPeriodEnd: false,
        razorpaySubscriptionId: FieldValue.delete(),
        currentPeriodStart: FieldValue.delete(),
        currentPeriodEnd: FieldValue.delete(),
        updatedAt: now,
      },
      subscription: {
        plan: "free",
        status: SUBSCRIPTION_STATUS.ACTIVE,
        expiresAt: null,
        interviewCredits: 3,
      },
      planTier: "free",
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  await batch.commit();

  logger.info("[webhook] Subscription cancelled — user downgraded to free", { uid, rzpSubId });
};

const handleSubscriptionExpired = async (payload: any): Promise<void> => {
  const subEntity = extractSubscriptionEntity(payload);
  const rzpSubId = subEntity.id;
  if (!rzpSubId) return;

  const uid = subEntity.notes?.userId || (await resolveUserIdFromSubscription(rzpSubId));
  if (!uid) return;

  if (await retainYearlyAccess(rzpSubId, uid, subEntity, true)) {
    logger.info("[webhook] Yearly plan expired at gateway — paid year kept", { uid, rzpSubId });
    return;
  }

  const now = new Date().toISOString();
  const batch = db.batch();

  // Mark subscription record as expired
  batch.update(subsCol().doc(rzpSubId), {
    status: SUBSCRIPTION_STATUS.EXPIRED,
    cancelAtPeriodEnd: false,
    updatedAt: now,
  });

  // Fully reset subscriptionSummary to free plan state
  batch.set(
    usersCol().doc(uid),
    {
      subscriptionSummary: {
        planId: "free",
        planName: "Free",
        billingCycle: "none",
        status: SUBSCRIPTION_STATUS.ACTIVE,
        provider: "none",
        cancelAtPeriodEnd: false,
        razorpaySubscriptionId: FieldValue.delete(),
        currentPeriodStart: FieldValue.delete(),
        currentPeriodEnd: FieldValue.delete(),
        updatedAt: now,
      },
      subscription: {
        plan: "free",
        status: SUBSCRIPTION_STATUS.ACTIVE,
        expiresAt: null,
        interviewCredits: 3,
      },
      planTier: "free",
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  await batch.commit();

  logger.info("[webhook] Subscription expired — user downgraded to free", { uid, rzpSubId });
};

const handlePaymentCaptured = async (payload: any): Promise<void> => {
  const payEntity = extractPaymentEntity(payload);
  const paymentId = payEntity.id;
  if (!paymentId) return;

  // Find subscription from payment
  const rzpSubId = payEntity.subscription_id;
  let uid = payEntity.notes?.userId;

  if (!uid && rzpSubId) {
    uid = await resolveUserIdFromSubscription(rzpSubId);
  }
  if (!uid) {
    logger.warn("[webhook] payment.captured — user not found", { paymentId });
    return;
  }

  // Read subscription doc for plan info
  let planId = "unknown";
  let country: string | undefined;
  let subCurrency: string | undefined;
  if (rzpSubId) {
    const subDoc = await subsCol().doc(rzpSubId).get();
    if (subDoc.exists) {
      const subData = subDoc.data() as SubscriptionRecord;
      planId = subData.planId;
      country = subData.country;
      subCurrency = subData.currency;
    }
  }

  // Store payment record (idempotent — use paymentId as doc ID)
  const paymentRecord: SubscriptionPaymentRecord = {
    userId: uid,
    razorpayPaymentId: paymentId,
    razorpayOrderId: payEntity.order_id || undefined,
    razorpaySubscriptionId: rzpSubId || undefined,
    planId,
    amount: payEntity.amount ? Number(payEntity.amount) / 100 : 0,
    currency: payEntity.currency || subCurrency || "USD",
    country,
    status: "captured",
    method: payEntity.method || undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await paymentsCol().doc(paymentId).set(paymentRecord, { merge: true });

  logger.info("[webhook] Payment captured", { uid, paymentId, planId, country, currency: paymentRecord.currency });
};

const handlePaymentFailed = async (payload: any): Promise<void> => {
  const payEntity = extractPaymentEntity(payload);
  const paymentId = payEntity.id;
  if (!paymentId) return;

  const rzpSubId = payEntity.subscription_id;
  let uid = payEntity.notes?.userId;

  if (!uid && rzpSubId) {
    uid = await resolveUserIdFromSubscription(rzpSubId);
  }
  if (!uid) return;

  let planId = "unknown";
  let country: string | undefined;
  let subCurrency: string | undefined;
  if (rzpSubId) {
    const subDoc = await subsCol().doc(rzpSubId).get();
    if (subDoc.exists) {
      const subData = subDoc.data() as SubscriptionRecord;
      planId = subData.planId;
      country = subData.country;
      subCurrency = subData.currency;
    }
  }

  const paymentRecord: SubscriptionPaymentRecord = {
    userId: uid,
    razorpayPaymentId: paymentId,
    razorpayOrderId: payEntity.order_id || undefined,
    razorpaySubscriptionId: rzpSubId || undefined,
    planId,
    amount: payEntity.amount ? Number(payEntity.amount) / 100 : 0,
    currency: payEntity.currency || subCurrency || "USD",
    country,
    status: "failed",
    method: payEntity.method || undefined,
    errorCode: payEntity.error_code || undefined,
    errorDescription: payEntity.error_description || undefined,
    errorReason: payEntity.error_reason || undefined,
    errorSource: payEntity.error_source || undefined,
    errorStep: payEntity.error_step || undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await paymentsCol().doc(paymentId).set(paymentRecord, { merge: true });

  const failureReason = paymentRecord.errorDescription || paymentRecord.errorReason || paymentRecord.errorCode;
  if (rzpSubId && failureReason) {
    await subsCol().doc(rzpSubId).set(
      {
        lastFailureReason: failureReason,
        ...(paymentRecord.errorCode ? { lastFailureCode: paymentRecord.errorCode } : {}),
        lastFailedPaymentId: paymentId,
        lastFailureAt: paymentRecord.updatedAt,
        updatedAt: paymentRecord.updatedAt,
      },
      { merge: true }
    );
  }

  logger.info("[webhook] Payment failed", { uid, paymentId, failureReason });
};

const handlePaymentRefunded = async (payload: any): Promise<void> => {
  const payEntity = extractPaymentEntity(payload);
  const refundEntity = payload?.payload?.refund?.entity || {};
  const paymentId = payEntity.id || refundEntity.payment_id;
  if (!paymentId) return;

  const now = new Date().toISOString();
  try {
    const paymentDoc = await paymentsCol().doc(paymentId).get();
    if (paymentDoc.exists) {
      const amountRefunded = refundEntity.amount
        ? Number(refundEntity.amount) / 100
        : payEntity.amount_refunded
        ? Number(payEntity.amount_refunded) / 100
        : undefined;

      await paymentsCol().doc(paymentId).update({
        status: "refunded",
        ...(amountRefunded !== undefined ? { amountRefunded } : {}),
        updatedAt: now,
      });
      logger.info("[webhook] Marked payment as refunded", { paymentId, amountRefunded });
    } else {
      logger.info("[webhook] Refund received for unrecorded payment doc", { paymentId });
    }
  } catch (err: any) {
    logger.warn("[webhook] Error updating payment record on refund", { paymentId, error: err.message });
  }
};
