import { Request, Response } from "express";
import * as paymentService from "./payment.service";
import { sendSuccess } from "../../shared/responses";

export const createOrder = async (req: Request, res: Response): Promise<void> => {
  const data = await paymentService.createOrder({
    userId: req.user!.uid,
    planId: String(req.body.planId),
  });
  sendSuccess(res, data, "Order created successfully");
};

export const verifyPayment = async (req: Request, res: Response): Promise<void> => {
  const data = await paymentService.verifyAndCapturePayment({
    userId: req.user!.uid,
    planId: String(req.body.planId),
    razorpay_order_id: String(req.body.razorpay_order_id),
    razorpay_payment_id: String(req.body.razorpay_payment_id),
    razorpay_signature: String(req.body.razorpay_signature),
  });
  sendSuccess(res, data, "Payment verified successfully");
};

export const paymentHistory = async (req: Request, res: Response): Promise<void> => {
  const data = await paymentService.getPaymentHistory(req.user!.uid);
  sendSuccess(res, data, "Payment history fetched successfully");
};

export const subscription = async (req: Request, res: Response): Promise<void> => {
  const data = await paymentService.getSubscription(req.user!.uid);
  sendSuccess(res, data, "Subscription fetched successfully");
};

export const webhook = async (req: Request, res: Response): Promise<void> => {
  await paymentService.handleWebhook(
    req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})),
    req.headers["x-razorpay-signature"] as string | undefined
  );
  sendSuccess(res, { received: true }, "Webhook processed successfully");
};
