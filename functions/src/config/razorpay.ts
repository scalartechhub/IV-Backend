import Razorpay from "razorpay";
import { AppError } from "../shared/utils";
import { firestoreConfigService } from "./firestore-config.service";

let razorpayInstance: Razorpay | null = null;
let currentKeyId: string | null = null;
let currentKeySecret: string | null = null;

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

/** Lazily initialized and automatically reloaded when Firestore configuration changes. */
export const getRazorpay = (): Razorpay => {
  const { keyId, keySecret } = getRazorpayConfig();
  if (!keyId || !keySecret) {
    razorpayInstance = null;
    currentKeyId = null;
    currentKeySecret = null;
    const missing: string[] = [];
    if (!keyId) missing.push("keyId");
    if (!keySecret) missing.push("keySecret");
    throw new AppError(
      503,
      `Razorpay payment configuration is missing: [${missing.join(", ")}]. Please set them in Firestore collection "config", document "razorpay".`
    );
  }

  // Reuse instance if keys haven't changed
  if (razorpayInstance && currentKeyId === keyId && currentKeySecret === keySecret) {
    return razorpayInstance;
  }

  currentKeyId = keyId;
  currentKeySecret = keySecret;
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
