import type { BillingCycle, BillingPlanIdWithCycle, SubscriptionStatus } from "../../constants/payment.constants";

// ---------------------------------------------------------------------------
// EXISTING — kept for backward compatibility
// ---------------------------------------------------------------------------

export interface Plan {
  id: string;
  name: string;
  /** Amount in smallest currency unit (e.g. paise for INR). */
  amount: number;
  currency: string;
  duration: number;
  interviewCredits: number;
  /**
   * Interviews allowed per calendar month.
   * `null` or negative = unlimited. Change this on the plan doc to update all users.
   */
  monthlyInterviewLimit?: number | null;
  /**
   * Resume analyses allowed per calendar month.
   * `null` or negative = unlimited. Change this on the plan doc to update all users.
   */
  monthlyResumeAnalysisLimit?: number | null;
  /** When false, plan cannot be purchased. Defaults to active when omitted. */
  isActive?: boolean;
}

export type PaymentStatus = "created" | "authorized" | "captured" | "failed" | string;

export interface PaymentRecord {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  userId: string;
  method: string;
  createdAt: string;
  planId: string;
  verifiedAt?: string;
  webhookEvent?: string;
}

export interface UserSubscription {
  plan: string;
  status: string;
  expiresAt: string | null;
  purchaseDate: string | null;
  interviewCredits: number;
  currentPaymentId?: string | null;
}

// ---------------------------------------------------------------------------
// NEW — Razorpay subscription architecture
// ---------------------------------------------------------------------------

/** Firestore: `plans/{planId}` — server-side plan configuration. */
export interface SubscriptionPlan {
  id: BillingPlanIdWithCycle | string;
  name: string;
  billingCycle: BillingCycle | "none";
  currency: string;
  /** Actual charge amount (annual for yearly, monthly for monthly). */
  amount: number;
  /** Display price shown in UI (monthly equivalent for yearly). */
  displayPrice: number;
  displayPeriod: "month" | "year";
  /** Actual annual charge (only for yearly plans). */
  annualAmount?: number;
  discountPercent: number;
  billingDescription?: string;
  description: string;
  /** Razorpay plan ID — never exposed to frontend. */
  razorpayPlanId?: string;
  active: boolean;
  features?: string[];
}

/** Firestore: `subscriptions/{subscriptionId}` */
export interface SubscriptionRecord {
  userId: string;
  provider: "razorpay" | "none";

  razorpaySubscriptionId?: string;
  razorpayCustomerId?: string;
  razorpayPlanId?: string;

  planId: BillingPlanIdWithCycle | string;
  planName: string;
  billingCycle: BillingCycle | "none";

  status: SubscriptionStatus;

  amount: number;
  currency: string;

  currentPeriodStart?: string;
  currentPeriodEnd?: string;

  cancelAtPeriodEnd: boolean;

  createdAt: string;
  updatedAt: string;
}

/** Embedded in `users/{uid}.subscriptionSummary` — lightweight subscription state. */
export interface SubscriptionSummary {
  planId: BillingPlanIdWithCycle | string;
  planName: string;
  billingCycle: BillingCycle | "none";
  status: SubscriptionStatus;
  provider: "razorpay" | "none";
  razorpaySubscriptionId?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  updatedAt: string;
}

/** Firestore: `payments/{paymentId}` */
export interface SubscriptionPaymentRecord {
  userId: string;

  razorpayPaymentId: string;
  razorpayOrderId?: string;
  razorpaySubscriptionId?: string;

  planId: BillingPlanIdWithCycle | string;

  amount: number;
  currency: string;

  status: PaymentStatus;
  method?: string;

  createdAt: string;
  updatedAt: string;
}

/** Firestore: `razorpayEvents/{eventId}` — webhook idempotency & audit trail. */
export interface RazorpayEventRecord {
  eventId: string;
  event: string;
  processed: boolean;
  processedAt?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

/** Data returned to frontend when creating a subscription (Checkout params). */
export interface CreateSubscriptionResponse {
  subscriptionId: string;
  keyId: string;
  planId: string;
  planName: string;
  billingCycle: string;
  amount: number;
  currency: string;
}

/** Frontend → Backend: verify payment after Razorpay Checkout. */
export interface VerifyPaymentInput {
  razorpayPaymentId: string;
  razorpaySubscriptionId: string;
  razorpaySignature: string;
}

/** Plan info returned to frontend (no secrets). */
export interface PlanPublicInfo {
  id: string;
  name: string;
  billingCycle: string;
  currency: string;
  displayPrice: number;
  displayPeriod: string;
  annualAmount?: number;
  discountPercent: number;
  description: string;
  billingDescription?: string;
  features?: string[];
  active: boolean;
}
