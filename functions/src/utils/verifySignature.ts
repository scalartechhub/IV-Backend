import crypto from "crypto";

interface VerifyPaymentSignatureInput {
  orderId: string;
  paymentId: string;
  signature: string;
  secret: string;
}

export const verifyPaymentSignature = ({
  orderId,
  paymentId,
  signature,
  secret,
}: VerifyPaymentSignatureInput): boolean => {
  const payload = `${orderId}|${paymentId}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
};

export const verifyWebhookSignature = (
  rawBody: Buffer,
  signature: string,
  secret: string
): boolean => {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
};
