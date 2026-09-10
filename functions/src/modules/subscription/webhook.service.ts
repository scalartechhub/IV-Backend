/**
 * Razorpay webhook event processor.
 * Handles signature validation, idempotency, and event dispatch.
 */

import { createHmac } from "crypto";
import { Timestamp } from "firebase-admin/firestore";
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
    throw new AppError(503, "Webhook secret is not configured.");
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
    case "subscription.halted":
      await handleSubscriptionHalted(payload);
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
  const currentPeriodEnd = subEntity.current_end
    ? new Date(subEntity.current_end * 1000).toISOString()
    : undefined;

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

  const currentPeriodStart = subEntity.current_start
    ? new Date(subEntity.current_start * 1000).toISOString()
    : undefined;
  const currentPeriodEnd = subEntity.current_end
    ? new Date(subEntity.current_end * 1000).toISOString()
    : undefined;

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
      currentPeriodStart,
      currentPeriodEnd,
    }
  );

  // Also update legacy expiresAt
  if (currentPeriodEnd) {
    await usersCol().doc(uid).set(
      {
        subscription: {
          status: SUBSCRIPTION_STATUS.ACTIVE,
          expiresAt: currentPeriodEnd,
        },
      },
      { merge: true }
    );
  }

  logger.info("[webhook] Subscription charged (renewed)", { uid, rzpSubId });
};

const handleSubscriptionHalted = async (payload: any): Promise<void> => {
  const subEntity = extractSubscriptionEntity(payload);
  const rzpSubId = subEntity.id;
  if (!rzpSubId) return;

  const uid = subEntity.notes?.userId || (await resolveUserIdFromSubscription(rzpSubId));
  if (!uid) return;

  await updateSubscriptionAndUser(
    rzpSubId,
    uid,
    { status: SUBSCRIPTION_STATUS.HALTED },
    { status: SUBSCRIPTION_STATUS.HALTED }
  );

  logger.info("[webhook] Subscription halted", { uid, rzpSubId });
};

const handleSubscriptionCancelled = async (payload: any): Promise<void> => {
  const subEntity = extractSubscriptionEntity(payload);
  const rzpSubId = subEntity.id;
  if (!rzpSubId) return;

  const uid = subEntity.notes?.userId || (await resolveUserIdFromSubscription(rzpSubId));
  if (!uid) return;

  await updateSubscriptionAndUser(
    rzpSubId,
    uid,
    { status: SUBSCRIPTION_STATUS.CANCELLED, cancelAtPeriodEnd: true },
    { status: SUBSCRIPTION_STATUS.CANCELLED, cancelAtPeriodEnd: true }
  );

  // Downgrade legacy subscription
  await usersCol().doc(uid).set(
    {
      subscription: {
        plan: "free",
        status: SUBSCRIPTION_STATUS.ACTIVE,
        expiresAt: null,
        interviewCredits: 3,
      },
    },
    { merge: true }
  );

  logger.info("[webhook] Subscription cancelled", { uid, rzpSubId });
};

const handleSubscriptionExpired = async (payload: any): Promise<void> => {
  const subEntity = extractSubscriptionEntity(payload);
  const rzpSubId = subEntity.id;
  if (!rzpSubId) return;

  const uid = subEntity.notes?.userId || (await resolveUserIdFromSubscription(rzpSubId));
  if (!uid) return;

  await updateSubscriptionAndUser(
    rzpSubId,
    uid,
    { status: SUBSCRIPTION_STATUS.EXPIRED },
    { status: SUBSCRIPTION_STATUS.EXPIRED }
  );

  // Downgrade legacy subscription
  await usersCol().doc(uid).set(
    {
      subscription: {
        plan: "free",
        status: SUBSCRIPTION_STATUS.EXPIRED,
        interviewCredits: 3,
      },
    },
    { merge: true }
  );

  logger.info("[webhook] Subscription expired", { uid, rzpSubId });
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
  if (rzpSubId) {
    const subDoc = await subsCol().doc(rzpSubId).get();
    if (subDoc.exists) {
      planId = (subDoc.data() as SubscriptionRecord).planId;
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
    currency: payEntity.currency || "USD",
    status: "captured",
    method: payEntity.method || undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await paymentsCol().doc(paymentId).set(paymentRecord, { merge: true });

  logger.info("[webhook] Payment captured", { uid, paymentId, planId });
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
  if (rzpSubId) {
    const subDoc = await subsCol().doc(rzpSubId).get();
    if (subDoc.exists) {
      planId = (subDoc.data() as SubscriptionRecord).planId;
    }
  }

  const paymentRecord: SubscriptionPaymentRecord = {
    userId: uid,
    razorpayPaymentId: paymentId,
    razorpayOrderId: payEntity.order_id || undefined,
    razorpaySubscriptionId: rzpSubId || undefined,
    planId,
    amount: payEntity.amount ? Number(payEntity.amount) / 100 : 0,
    currency: payEntity.currency || "USD",
    status: "failed",
    method: payEntity.method || undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await paymentsCol().doc(paymentId).set(paymentRecord, { merge: true });

  logger.info("[webhook] Payment failed", { uid, paymentId });
};
