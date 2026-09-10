/**
 * V2 subscription, payment, plan & webhook routes.
 *
 * Routes:
 *   GET    /plans                — public, returns active plans
 *   POST   /subscriptions/create — auth, create Razorpay subscription
 *   GET    /subscriptions/current — auth, current subscription status
 *   POST   /subscriptions/cancel — auth, cancel at period end
 *   POST   /payments/verify     — auth, verify Razorpay payment
 *   GET    /payments/history    — auth, payment history
 *   GET    /usage               — auth, usage summary
 *   POST   /subscriptions/free  — auth, activate free plan
 *   POST   /webhooks/razorpay   — Razorpay webhook (NO Firebase auth)
 */

import { Router, Request } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async.middleware";
import { validate } from "../../middleware/validation.middleware";
import verifyToken from "../../middleware/auth.middleware";
import { sendSuccess, sendCreated } from "../../shared/responses";
import * as razorpaySubscriptionService from "../subscription/razorpay-subscription.service";
import * as webhookService from "../subscription/webhook.service";
import * as featureAccessService from "../subscription/feature-access.service";

const router = Router();

// ---------------------------------------------------------------------------
// SCHEMAS
// ---------------------------------------------------------------------------

const createSubSchema = z.object({
  planId: z.string().min(1, "Plan ID is required"),
});

const verifyPaymentSchema = z.object({
  razorpayPaymentId: z.string().min(1),
  razorpaySubscriptionId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

// ---------------------------------------------------------------------------
// PUBLIC ROUTES (no auth)
// ---------------------------------------------------------------------------

router.get(
  "/plans",
  asyncHandler(async (_req, res) => {
    const plans = await razorpaySubscriptionService.getActivePlans();
    sendSuccess(res, plans, "Plans fetched");
  })
);

// Webhook — must NOT have Firebase auth, uses its own signature validation
router.post(
  "/webhooks/razorpay",
  asyncHandler(async (req: Request, res) => {
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody) {
      res.status(400).json({ success: false, message: "Raw body not available for signature validation." });
      return;
    }
    const signature = req.headers["x-razorpay-signature"] as string | undefined;
    await webhookService.handleWebhookEvent(rawBody, signature);
    // Always return 200 to Razorpay
    res.status(200).json({ success: true, message: "Webhook processed" });
  })
);

// ---------------------------------------------------------------------------
// AUTHENTICATED ROUTES
// ---------------------------------------------------------------------------

router.use(verifyToken);

router.post(
  "/subscriptions/create",
  validate(createSubSchema),
  asyncHandler(async (req, res) => {
    const { planId } = req.body as z.infer<typeof createSubSchema>;
    const result = await razorpaySubscriptionService.createSubscription(req.user!.uid, planId);
    sendCreated(res, result, "Subscription created");
  })
);

router.get(
  "/subscriptions/current",
  asyncHandler(async (req, res) => {
    const result = await razorpaySubscriptionService.getCurrentSubscription(req.user!.uid);
    sendSuccess(res, result, "Current subscription fetched");
  })
);

router.post(
  "/subscriptions/cancel",
  asyncHandler(async (req, res) => {
    const result = await razorpaySubscriptionService.cancelSubscription(req.user!.uid);
    sendSuccess(res, result, "Subscription cancellation scheduled");
  })
);

router.post(
  "/subscriptions/free",
  asyncHandler(async (req, res) => {
    await razorpaySubscriptionService.activateFreePlan(req.user!.uid);
    sendSuccess(res, { planId: "free" }, "Free plan activated");
  })
);

router.post(
  "/payments/verify",
  validate(verifyPaymentSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof verifyPaymentSchema>;
    const result = await razorpaySubscriptionService.verifyPayment(req.user!.uid, input);
    sendSuccess(res, result, "Payment verified");
  })
);

router.get(
  "/payments/history",
  asyncHandler(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const result = await razorpaySubscriptionService.getPaymentHistory(req.user!.uid, limit);
    sendSuccess(res, result, "Payment history fetched");
  })
);

router.get(
  "/usage",
  asyncHandler(async (req, res) => {
    const result = await featureAccessService.getUsageSummary(req.user!.uid);
    sendSuccess(res, result, "Usage summary fetched");
  })
);

export default router;
