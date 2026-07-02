import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { razorpay, razorpayConfig } from "../config/razorpay";
import { PLAN_DEFAULTS, PLAN_IDS, SUBSCRIPTION_STATUS } from "../constants/payment.constants";
import type { PaymentRecord, Plan, UserSubscription } from "../models/payment.model";
import { AppError } from "../shared/utils";
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

// Lazy accessors — db is assigned only after initializeFirebase() in server.ts
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

const getPlanById = async (planId: string): Promise<Plan> => {
  const snap = await getPlansCollection().doc(planId).get();
  if (!snap.exists) {
    throw new AppError(404, "Plan not found");
  }

  const plan = snap.data() as Plan;
  if (!plan?.id || typeof plan.amount !== "number" || !plan?.name) {
    throw new AppError(500, "Invalid plan configuration in Firestore");
  }
  return plan;
};

const updateSubscriptionForPlan = async (userId: string, plan: Plan): Promise<UserSubscription> => {
  const now = new Date();
  const fallback = PLAN_DEFAULTS[plan.id as keyof typeof PLAN_DEFAULTS] ?? {
    duration: plan.duration ?? 0,
    interviewCredits: plan.interviewCredits ?? 3,
  };
  const duration = plan.duration ?? fallback.duration;
  const interviewCredits = plan.interviewCredits ?? fallback.interviewCredits;
  const expiresAt = computeExpiryDate(duration);

  const subscription: UserSubscription = {
    plan: plan.id,
    status: SUBSCRIPTION_STATUS.ACTIVE,
    expiresAt: expiresAt?.toISOString() ?? null,
    purchaseDate: now.toISOString(),
    interviewCredits,
  };

  await getUsersCollection().doc(userId).set(
    {
      uid: userId,
      subscription,
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  return subscription;
};

export const createOrder = async ({ userId, planId }: CreateOrderInput) => {
  const plan = await getPlanById(planId);

  const order = await razorpay.orders.create({
    amount: plan.amount,
    currency: plan.currency,
    receipt: `rcpt_${userId}_${Date.now()}`.slice(0, 40),
    notes: {
      userId,
      planId: plan.id,
    },
  });

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: razorpayConfig.keyId,
  };
};

export const verifyAndCapturePayment = async ({
  userId,
  planId,
  razorpay_order_id,
  razorpay_payment_id,
  razorpay_signature,
}: VerifyPaymentInput): Promise<{ success: true }> => {
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!secret) {
    throw new AppError(500, "Payment secret is not configured");
  }

  const isValid = verifyPaymentSignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
    secret,
  });

  if (!isValid) {
    throw new AppError(400, "Invalid payment signature");
  }

  const plan = await getPlanById(planId);
  const paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);

  const paymentRecord: PaymentRecord = {
    paymentId: razorpay_payment_id,
    orderId: razorpay_order_id,
    amount: Number(paymentDetails.amount ?? plan.amount),
    currency: String(paymentDetails.currency ?? "INR"),
    status: String(paymentDetails.status ?? "captured"),
    userId,
    method: String(paymentDetails.method ?? "unknown"),
    createdAt: new Date().toISOString(),
    planId: plan.id,
  };

  await getPaymentsCollection().doc(paymentRecord.paymentId).set(paymentRecord, { merge: true });
  await updateSubscriptionForPlan(userId, plan);

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
  if (!userSnap.exists) {
    return {
      plan: PLAN_IDS.FREE,
      status: SUBSCRIPTION_STATUS.ACTIVE,
      expiry: null,
      remainingDays: null,
    };
  }

  const user = userSnap.data() as { subscription?: UserSubscription };
  const subscription = user.subscription;
  if (!subscription) {
    return {
      plan: PLAN_IDS.FREE,
      status: SUBSCRIPTION_STATUS.ACTIVE,
      expiry: null,
      remainingDays: null,
    };
  }

  const expiry = tsToIso(subscription.expiresAt);
  let remainingDays: number | null = null;
  if (expiry) {
    const diffMs = new Date(expiry).getTime() - Date.now();
    remainingDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  return {
    plan: subscription.plan,
    status: subscription.status,
    expiry,
    remainingDays,
  };
};

export const handleWebhook = async (rawBody: Buffer, signature: string | undefined): Promise<void> => {
  if (!signature) {
    throw new AppError(401, "Missing webhook signature");
  }
  if (!razorpayConfig.webhookSecret) {
    throw new AppError(500, "Razorpay webhook secret is not configured");
  }

  const valid = verifyWebhookSignature(rawBody, signature, razorpayConfig.webhookSecret);
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
  const userId = String(
    (paymentEntity.notes as Record<string, unknown> | undefined)?.userId ??
      (orderEntity.notes as Record<string, unknown> | undefined)?.userId ??
      ""
  );
  const planId = String(
    (paymentEntity.notes as Record<string, unknown> | undefined)?.planId ??
      (orderEntity.notes as Record<string, unknown> | undefined)?.planId ??
      ""
  );

  switch (event.event) {
    case "payment.captured":
    case "order.paid":
    case "payment.authorized":
    case "payment.failed": {
      if (!paymentId && !orderId) return;

      await getPaymentsCollection().doc(paymentId || orderId).set(
        {
          paymentId: paymentId || null,
          orderId: orderId || null,
          amount: Number(paymentEntity.amount ?? orderEntity.amount ?? 0),
          currency: String(paymentEntity.currency ?? orderEntity.currency ?? "INR"),
          status: String(paymentEntity.status ?? event.event),
          userId: userId || null,
          method: String(paymentEntity.method ?? "unknown"),
          createdAt: new Date().toISOString(),
          planId: planId || null,
          webhookEvent: event.event,
        },
        { merge: true }
      );

      if (event.event !== "payment.failed" && userId && planId) {
        const plan = await getPlanById(planId);
        await updateSubscriptionForPlan(userId, plan);
      }

      if (event.event === "payment.failed" && userId) {
        await getUsersCollection().doc(userId).set(
          {
            uid: userId,
            subscription: {
              status: SUBSCRIPTION_STATUS.FAILED,
            },
            updatedAt: Timestamp.now(),
          },
          { merge: true }
        );
      }
      break;
    }
    default:
      break;
  }
};
