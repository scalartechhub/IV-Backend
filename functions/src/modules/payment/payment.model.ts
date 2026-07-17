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
