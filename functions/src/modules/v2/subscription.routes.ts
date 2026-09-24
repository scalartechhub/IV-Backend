/**
 * V2 subscription, payment, plan & webhook routes.
 *
 * Routes:
 *   GET    /plans                  — public, returns active plans
 *   POST   /subscriptions/create   — auth, create Razorpay subscription
 *   GET    /subscriptions/current  — auth, current subscription status
 *   POST   /subscriptions/cancel   — auth, cancel at period end
 *   POST   /subscriptions/resume   — auth, reverse scheduled cancellation
 *   POST   /subscriptions/change-plan — auth, upgrade/downgrade subscription plan
 *   POST   /payments/verify        — auth, verify Razorpay payment
 *   GET    /payments/history       — auth, payment history
 *   GET    /usage                  — auth, usage summary
 *   POST   /subscriptions/free     — auth, activate free plan
 *   POST   /webhooks/razorpay      — Razorpay webhook (NO Firebase auth)
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
  currency: z.enum(["USD"]).optional().default("USD"),
});

const changePlanSchema = z.object({
  planId: z.string().min(1, "Plan ID is required"),
  scheduleChangeAt: z.enum(["now", "cycle_end"]).optional().default("now"),
});

// Accepts both camelCase (API standard) and snake_case (Razorpay Checkout native callback)
const verifyPaymentSchema = z
  .object({
    razorpayPaymentId: z.string().optional(),
    razorpaySubscriptionId: z.string().optional(),
    razorpaySignature: z.string().optional(),
    razorpay_payment_id: z.string().optional(),
    razorpay_subscription_id: z.string().optional(),
    razorpay_signature: z.string().optional(),
  })
  .transform((data) => ({
    razorpayPaymentId: (data.razorpayPaymentId || data.razorpay_payment_id || "").trim(),
    razorpaySubscriptionId: (data.razorpaySubscriptionId || data.razorpay_subscription_id || "").trim(),
    razorpaySignature: (data.razorpaySignature || data.razorpay_signature || "").trim(),
  }))
  .refine(
    (data) => Boolean(data.razorpayPaymentId && data.razorpaySubscriptionId && data.razorpaySignature),
    {
      message: "razorpayPaymentId, razorpaySubscriptionId, and razorpaySignature are required",
    }
  );

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
    const { planId, currency } = req.body as z.infer<typeof createSubSchema>;
    const result = await razorpaySubscriptionService.createSubscription(
      req.user!.uid,
      planId,
      currency
    );
    sendCreated(res, result, "Subscription initiated");
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
  "/subscriptions/resume",
  asyncHandler(async (req, res) => {
    const result = await razorpaySubscriptionService.resumeSubscription(req.user!.uid);
    sendSuccess(res, result, "Subscription cancellation reversed");
  })
);

router.post(
  "/subscriptions/change-plan",
  validate(changePlanSchema),
  asyncHandler(async (req, res) => {
    const { planId, scheduleChangeAt } = req.body as z.infer<typeof changePlanSchema>;
    const result = await razorpaySubscriptionService.changeSubscriptionPlan(
      req.user!.uid,
      planId,
      scheduleChangeAt
    );
    sendSuccess(res, result, "Subscription plan updated");
  })
);

router.post(
  "/subscriptions/free",
  asyncHandler(async (req, res) => {
    const result = await razorpaySubscriptionService.activateFreePlan(req.user!.uid);
    const message = result.scheduledForPeriodEnd
      ? "Subscription cancellation scheduled at period end"
      : "Free plan activated";
    sendSuccess(res, result, message);
  })
);

router.post(
  "/payments/verify",
  validate(verifyPaymentSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as { razorpayPaymentId: string; razorpaySubscriptionId: string; razorpaySignature: string };
    const result = await razorpaySubscriptionService.verifyPayment(req.user!.uid, input);
    sendSuccess(res, result, "Payment verified");
  })
);

router.get(
  "/payments/history",
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
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
