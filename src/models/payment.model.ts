export interface Plan {
  id: string;
  name: string;
  amount: number;
  currency: string;
  duration: number;
  interviewCredits: number;
}

export interface PaymentRecord {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  status: string;
  userId: string;
  method: string;
  createdAt: string;
  planId: string;
}

export interface UserSubscription {
  plan: string;
  status: string;
  expiresAt: string | null;
  purchaseDate: string | null;
  interviewCredits: number;
}
