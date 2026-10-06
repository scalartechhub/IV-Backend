import Razorpay from "razorpay";
import { AppError } from "../shared/utils";
import { firestoreConfigService } from "./firestore-config.service";

let razorpayInstance: Razorpay | null = null;
let currentKeyId: string | null = null;
let currentKeySecret: string | null = null;

const isPlaceholder = (val?: string): boolean => {
  if (!val) return true;
  const lower = val.toLowerCase().trim();
  return (
    lower.includes("xxxx") ||
    lower.includes("your-razorpay") ||
    lower.includes("placeholder") ||
    lower === "your-key-id" ||
    lower === "your-key-secret"
  );
};

export const getRazorpayConfig = () => {
  const config = firestoreConfigService.getRazorpayConfig();
  const envKeyId = (process.env.RAZORPAY_KEY_ID || "").trim();
  const envKeySecret = (process.env.RAZORPAY_KEY_SECRET || "").trim();
  const envWebhook = (process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();

  const keyId = (!isPlaceholder(config.keyId) ? config.keyId! : envKeyId).trim();
  const keySecret = (!isPlaceholder(config.keySecret) ? config.keySecret! : envKeySecret).trim();
  const webhookSecret = (!isPlaceholder(config.webhookSecret) ? config.webhookSecret! : envWebhook).trim();

  return {
    keyId,
    keySecret,
    webhookSecret,
    proMonthlyPlanId: config.proMonthlyPlanId || process.env.RAZORPAY_PRO_MONTHLY_PLAN_ID,
    proYearlyPlanId: config.proYearlyPlanId || process.env.RAZORPAY_PRO_YEARLY_PLAN_ID,
    eliteMonthlyPlanId: config.eliteMonthlyPlanId || process.env.RAZORPAY_ELITE_MONTHLY_PLAN_ID,
    eliteYearlyPlanId: config.eliteYearlyPlanId || process.env.RAZORPAY_ELITE_YEARLY_PLAN_ID,
    proMonthlyPlanIdUsd: config.proMonthlyPlanIdUsd || process.env.RAZORPAY_PRO_MONTHLY_PLAN_ID_USD,
    proYearlyPlanIdUsd: config.proYearlyPlanIdUsd || process.env.RAZORPAY_PRO_YEARLY_PLAN_ID_USD,
    eliteMonthlyPlanIdUsd: config.eliteMonthlyPlanIdUsd || process.env.RAZORPAY_ELITE_MONTHLY_PLAN_ID_USD,
    eliteYearlyPlanIdUsd: config.eliteYearlyPlanIdUsd || process.env.RAZORPAY_ELITE_YEARLY_PLAN_ID_USD,
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
