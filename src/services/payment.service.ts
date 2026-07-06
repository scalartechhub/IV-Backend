import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { getRazorpay, getRazorpayConfig, isRazorpayConfigured } from "../config/razorpay";
import { PLAN_DEFAULTS, PLAN_IDS, PLAN_MONTHLY_INTERVIEW_LIMITS, SUBSCRIPTION_STATUS } from "../constants/payment.constants";
import * as userRepo from "../modules/auth/auth.repository";
import { countInterviewsCreatedThisMonth } from "../modules/auth/auth.repository";
import { isSubscriptionExpired } from "../modules/subscription/subscription.service";
import type { PaymentRecord, Plan, UserSubscription } from "../models/payment.model";
import type { User } from "../modules/auth/auth.types";
import { getStartOfNextMonth, resolveBillingPlan } from "../shared/plan.utils";
import { AppError } from "../shared/utils";
import { logger } from "../shared/logger";
import { verifyPaymentSignature, verifyWebhookSignature } from "../utils/verifySignature";

interface CreateOrderInput {
  userId: string;
  planId: string;
}

interface VerifyPaymentInput {
  userId: string;
  planId: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

const CAPTURED_STATUS = "captured";
const WEBHOOK_ACTIVATION_EVENTS = new Set(["payment.captured", "order.paid"]);

const getPlansCollection = () => db.collection("plans");
const getPaymentsCollection = () => db.collection("payments");
const getUsersCollection = () => db.collection("users");

const tsToIso = (value: Timestamp | string | null | undefined): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.toDate().toISOString();
};

const computeExpiryDate = (durationInDays: number): Date | null => {
  if (durationInDays <= 0) return null;
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + durationInDays);
  return expiry;
};

const readNote = (notes: Record<string, unknown> | undefined, key: string): string =>
  String(notes?.[key] ?? "").trim();

const getPlanById = async (planId: string): Promise<Plan> => {
  const snap = await getPlansCollection().doc(planId).get();
  if (!snap.exists) {
    throw new AppError(404, "Plan not found");
  }

  const plan = { id: snap.id, ...snap.data() } as Plan;
  if (!plan.id || typeof plan.amount !== "number" || !plan.name) {
    throw new AppError(500, "Invalid plan configuration in Firestore");
  }

  if (plan.isActive === false) {
    throw new AppError(400, "This plan is not available for purchase.");
  }

  if (!plan.currency?.trim()) {
    throw new AppError(500, "Invalid plan configuration: currency is required");
  }

  return plan;
};

const buildSubscriptionForPlan = (plan: Plan, paymentId: string): UserSubscription => {
  const now = new Date();
  const fallback = PLAN_DEFAULTS[plan.id as keyof typeof PLAN_DEFAULTS] ?? {
    duration: plan.duration ?? 0,
    interviewCredits: plan.interviewCredits ?? 3,
  };
  const duration = plan.duration ?? fallback.duration;
  const interviewCredits = plan.interviewCredits ?? fallback.interviewCredits;
  const expiresAt = computeExpiryDate(duration);

  return {
    plan: plan.id,
    status: SUBSCRIPTION_STATUS.ACTIVE,
    expiresAt: expiresAt?.toISOString() ?? null,
    purchaseDate: now.toISOString(),
    interviewCredits,
    currentPaymentId: paymentId,
  };
};

const activateSubscriptionInTransaction = async (
  userId: string,
  plan: Plan,
  paymentRecord: PaymentRecord
): Promise<void> => {
  const paymentRef = getPaymentsCollection().doc(paymentRecord.paymentId);
  const userRef = getUsersCollection().doc(userId);
  const subscription = buildSubscriptionForPlan(plan, paymentRecord.paymentId);

  await db.runTransaction(async (tx) => {
    const existingPayment = await tx.get(paymentRef);
    if (existingPayment.exists) {
      const existing = existingPayment.data() as PaymentRecord;
      if (existing.status === CAPTURED_STATUS) {
        return;
      }
    }

    tx.set(paymentRef, paymentRecord, { merge: false });
    tx.set(
      userRef,
      {
        uid: userId,
        subscription,
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
  });
};

const validateOrderAndPayment = async (input: {
  userId: string;
  planId: string;
  orderId: string;
  paymentId: string;
}): Promise<{ plan: Plan; paymentRecord: PaymentRecord }> => {
  const razorpay = getRazorpay();
  const order = (await razorpay.orders.fetch(input.orderId)) as {
    id: string;
    amount: number | string;
    currency: string;
    notes?: Record<string, unknown>;
  };

  const orderUserId = readNote(order.notes, "userId");
  const orderPlanId = readNote(order.notes, "planId");

  if (!orderUserId || orderUserId !== input.userId) {
    throw new AppError(403, "This order does not belong to the authenticated user.");
  }

  if (!orderPlanId) {
    throw new AppError(400, "Order is missing plan information.");
  }

  if (input.planId !== orderPlanId) {
    throw new AppError(400, "Plan does not match the order that was created.");
  }

  const plan = await getPlanById(orderPlanId);
  const paymentDetails = (await razorpay.payments.fetch(input.paymentId)) as {
    id: string;
    order_id: string;
    amount: number | string;
    currency: string;
    status: string;
    method?: string;
  };

  if (paymentDetails.order_id !== input.orderId) {
    throw new AppError(400, "Payment does not belong to the provided order.");
  }

  if (paymentDetails.status !== CAPTURED_STATUS) {
    throw new AppError(400, `Payment is not captured yet (status: ${paymentDetails.status}).`);
  }

  const orderAmount = Number(order.amount);
  const paymentAmount = Number(paymentDetails.amount);

  if (orderAmount !== plan.amount || paymentAmount !== plan.amount) {
    throw new AppError(400, "Payment amount does not match the plan price.");
  }

  const orderCurrency = String(order.currency).toUpperCase();
  const paymentCurrency = String(paymentDetails.currency).toUpperCase();
  const planCurrency = plan.currency.toUpperCase();

  if (orderCurrency !== planCurrency || paymentCurrency !== planCurrency) {
    throw new AppError(400, "Payment currency does not match the plan currency.");
  }

  const paymentRecord: PaymentRecord = {
    paymentId: input.paymentId,
    orderId: input.orderId,
    amount: paymentAmount,
    currency: paymentCurrency,
    status: CAPTURED_STATUS,
    userId: input.userId,
    method: String(paymentDetails.method ?? "unknown"),
    createdAt: new Date().toISOString(),
    planId: plan.id,
    verifiedAt: new Date().toISOString(),
  };

  return { plan, paymentRecord };
};

export const createOrder = async ({ userId, planId }: CreateOrderInput) => {
  if (!isRazorpayConfigured()) {
    throw new AppError(503, "Payment service is not configured.");
  }

  await userRepo.requireUserById(userId);
  const plan = await getPlanById(planId);

  if (plan.id === PLAN_IDS.FREE || plan.amount <= 0) {
    throw new AppError(400, "This plan does not require payment.");
  }

  const razorpay = getRazorpay();
  const order = await razorpay.orders.create({
    amount: plan.amount,
    currency: plan.currency,
    receipt: `rcpt_${userId}_${Date.now()}`.slice(0, 40),
    notes: {
      userId,
      planId: plan.id,
    },
  });

  logger.info(`[payment.service] order created userId=${userId} planId=${plan.id} orderId=${order.id}`);

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: getRazorpayConfig().keyId,
  };
};

export const verifyAndCapturePayment = async ({
  userId,
  planId,
  razorpay_order_id,
  razorpay_payment_id,
  razorpay_signature,
}: VerifyPaymentInput): Promise<{ success: true; alreadyProcessed?: boolean }> => {
  const { keySecret } = getRazorpayConfig();
  if (!keySecret) {
    throw new AppError(500, "Payment secret is not configured");
  }

  const existingSnap = await getPaymentsCollection().doc(razorpay_payment_id).get();
  if (existingSnap.exists) {
    const existing = existingSnap.data() as PaymentRecord;
    if (existing.status === CAPTURED_STATUS && existing.userId === userId) {
      return { success: true, alreadyProcessed: true };
    }
  }

  const isValid = verifyPaymentSignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
    secret: keySecret,
  });

  if (!isValid) {
    throw new AppError(400, "Invalid payment signature");
  }

  const { plan, paymentRecord } = await validateOrderAndPayment({
    userId,
    planId,
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
  });

  await activateSubscriptionInTransaction(userId, plan, paymentRecord);
  logger.info(`[payment.service] payment verified userId=${userId} paymentId=${razorpay_payment_id}`);

  return { success: true };
};

export const getPaymentHistory = async (userId: string): Promise<PaymentRecord[]> => {
  const snap = await getPaymentsCollection()
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
    .get();

  return snap.docs.map((doc) => doc.data() as PaymentRecord);
};

export const getSubscription = async (userId: string) => {
  const userSnap = await getUsersCollection().doc(userId).get();
  const freeCredits = PLAN_DEFAULTS[PLAN_IDS.FREE].interviewCredits;
  const emptyQuota = {
    monthlyInterviewLimit: PLAN_MONTHLY_INTERVIEW_LIMITS[PLAN_IDS.FREE],
    interviewsUsedThisMonth: 0,
    interviewsRemainingThisMonth: PLAN_MONTHLY_INTERVIEW_LIMITS[PLAN_IDS.FREE],
    quotaResetsAt: getStartOfNextMonth().toISOString(),
  };

  if (!userSnap.exists) {
    return {
      plan: PLAN_IDS.FREE,
      status: SUBSCRIPTION_STATUS.ACTIVE,
      expiry: null,
      remainingDays: null,
      interviewCredits: freeCredits,
      ...emptyQuota,
    };
  }

  const user = { ...(userSnap.data() as User), uid: userId };
  let subscription = user.subscription as UserSubscription | undefined;
  const billingPlan = resolveBillingPlan(user);
  const monthlyLimit = PLAN_MONTHLY_INTERVIEW_LIMITS[billingPlan];
  const interviewsUsedThisMonth = await countInterviewsCreatedThisMonth(userId);
  const interviewsRemainingThisMonth =
    monthlyLimit === null ? null : Math.max(0, monthlyLimit - interviewsUsedThisMonth);

  if (
    subscription &&
    subscription.status === SUBSCRIPTION_STATUS.ACTIVE &&
    subscription.plan !== PLAN_IDS.FREE &&
    isSubscriptionExpired(subscription.expiresAt)
  ) {
    subscription = {
      plan: PLAN_IDS.FREE,
      status: SUBSCRIPTION_STATUS.EXPIRED,
      expiresAt: subscription.expiresAt ?? null,
      purchaseDate: subscription.purchaseDate ?? null,
      interviewCredits: freeCredits,
      currentPaymentId: subscription.currentPaymentId ?? null,
    };
  }

  if (!subscription) {
    return {
      plan: PLAN_IDS.FREE,
      status: SUBSCRIPTION_STATUS.ACTIVE,
      expiry: null,
      remainingDays: null,
      interviewCredits: freeCredits,
      monthlyInterviewLimit: monthlyLimit,
      interviewsUsedThisMonth,
      interviewsRemainingThisMonth,
      quotaResetsAt: getStartOfNextMonth().toISOString(),
    };
  }

  const expiry = tsToIso(subscription.expiresAt);
  let remainingDays: number | null = null;
  if (expiry) {
    const diffMs = new Date(expiry).getTime() - Date.now();
    remainingDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  return {
    plan: billingPlan,
    status: subscription.status,
    expiry,
    remainingDays,
    interviewCredits: subscription.interviewCredits,
    monthlyInterviewLimit: monthlyLimit,
    interviewsUsedThisMonth,
    interviewsRemainingThisMonth,
    quotaResetsAt: getStartOfNextMonth().toISOString(),
  };
};

export const handleWebhook = async (rawBody: Buffer, signature: string | undefined): Promise<void> => {
  if (!signature) {
    throw new AppError(401, "Missing webhook signature");
  }

  const { webhookSecret } = getRazorpayConfig();
  if (!webhookSecret) {
    throw new AppError(500, "Razorpay webhook secret is not configured");
  }

  const valid = verifyWebhookSignature(rawBody, signature, webhookSecret);
  if (!valid) {
    throw new AppError(401, "Invalid webhook signature");
  }

  const event = JSON.parse(rawBody.toString("utf-8")) as {
    event: string;
    payload: {
      payment?: { entity?: Record<string, unknown> };
      order?: { entity?: Record<string, unknown> };
    };
  };

  const paymentEntity = event.payload.payment?.entity ?? {};
  const orderEntity = event.payload.order?.entity ?? {};
  const paymentId = String(paymentEntity.id ?? "");
  const orderId = String(orderEntity.id ?? paymentEntity.order_id ?? "");
  const paymentNotes = paymentEntity.notes as Record<string, unknown> | undefined;
  const orderNotes = orderEntity.notes as Record<string, unknown> | undefined;
  const userId = readNote(paymentNotes, "userId") || readNote(orderNotes, "userId");
  const planId = readNote(paymentNotes, "planId") || readNote(orderNotes, "planId");

  if (!paymentId && !orderId) {
    logger.warn(`[payment.service] webhook ignored event=${event.event} — missing ids`);
    return;
  }

  const docId = paymentId || orderId;
  const baseRecord: Partial<PaymentRecord> = {
    paymentId: paymentId || docId,
    orderId: orderId || "",
    amount: Number(paymentEntity.amount ?? orderEntity.amount ?? 0),
    currency: String(paymentEntity.currency ?? orderEntity.currency ?? "INR"),
    status: String(paymentEntity.status ?? event.event),
    userId: userId || "",
    method: String(paymentEntity.method ?? "unknown"),
    createdAt: new Date().toISOString(),
    planId: planId || "",
    webhookEvent: event.event,
  };

  if (event.event === "payment.failed") {
    await getPaymentsCollection().doc(docId).set(baseRecord, { merge: true });
    logger.info(`[payment.service] webhook payment.failed paymentId=${paymentId}`);
    return;
  }

  if (!WEBHOOK_ACTIVATION_EVENTS.has(event.event)) {
    logger.debug(`[payment.service] webhook ignored event=${event.event}`);
    return;
  }

  if (!userId || !planId || !paymentId || !orderId) {
    logger.warn(`[payment.service] webhook activation skipped — missing metadata event=${event.event}`);
    await getPaymentsCollection().doc(docId).set(baseRecord, { merge: true });
    return;
  }

  const existingSnap = await getPaymentsCollection().doc(paymentId).get();
  if (existingSnap.exists && (existingSnap.data() as PaymentRecord).status === CAPTURED_STATUS) {
    logger.info(`[payment.service] webhook skipped duplicate paymentId=${paymentId}`);
    return;
  }

  try {
    const { plan, paymentRecord } = await validateOrderAndPayment({
      userId,
      planId,
      orderId,
      paymentId,
    });
    paymentRecord.webhookEvent = event.event;
    await activateSubscriptionInTransaction(userId, plan, paymentRecord);
    logger.info(`[payment.service] webhook activated subscription userId=${userId} paymentId=${paymentId}`);
  } catch (error) {
    logger.error(`[payment.service] webhook activation failed paymentId=${paymentId}`, error);
    await getPaymentsCollection().doc(docId).set(baseRecord, { merge: true });
    throw error;
  }
};
