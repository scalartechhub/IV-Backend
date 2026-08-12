import Razorpay from "razorpay";
import { AppError } from "../shared/utils";
import { firestoreConfigService } from "./firestore-config.service";

let razorpayInstance: Razorpay | null = null;

export const getRazorpayConfig = () => {
  const config = firestoreConfigService.getRazorpayConfig();
  return {
    keyId: (config.keyId || process.env.RAZORPAY_KEY_ID || "").trim(),
    keySecret: (config.keySecret || process.env.RAZORPAY_KEY_SECRET || "").trim(),
    webhookSecret: (config.webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET || "").trim(),
  };
};

export const isRazorpayConfigured = (): boolean => {
  const { keyId, keySecret } = getRazorpayConfig();
  return Boolean(keyId && keySecret);
};

/** Lazily initialized so the app can start when Razorpay env vars are unset (non-payment routes). */
export const getRazorpay = (): Razorpay => {
  if (razorpayInstance) return razorpayInstance;

  const { keyId, keySecret } = getRazorpayConfig();
  if (!keyId || !keySecret) {
    throw new AppError(503, "Payment service is not configured. Please try again later.");
  }

  razorpayInstance = new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });

  return razorpayInstance;
};

/** @deprecated Use getRazorpay() — kept for gradual migration */
export const razorpay = new Proxy({} as Razorpay, {
  get(_target, prop) {
    return Reflect.get(getRazorpay(), prop, getRazorpay());
  },
});

/** @deprecated Use getRazorpayConfig() */
export const razorpayConfig = {
  get keyId() {
    return getRazorpayConfig().keyId;
  },
  get webhookSecret() {
    return getRazorpayConfig().webhookSecret;
  },
};
