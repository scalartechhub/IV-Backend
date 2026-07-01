import Razorpay from "razorpay";

const keyId = process.env.RAZORPAY_KEY_ID?.trim();
const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

if (!keyId || !keySecret) {
  throw new Error("Missing Razorpay credentials. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
}

export const razorpay = new Razorpay({
  key_id: keyId,
  key_secret: keySecret,
});

export const razorpayConfig = {
  keyId,
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? "",
} as const;
