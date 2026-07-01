import { Router } from "express";
import verifyToken from "../middleware/auth.middleware";
import { asyncHandler } from "../middleware/async.middleware";
import { checkRequestValidation } from "../middleware/request-validation.middleware";
import * as paymentController from "../controllers/payment.controller";
import { createOrderValidator, verifyPaymentValidator } from "../validators/payment.validator";

const router = Router();

/**
 * @openapi
 * /payment/create-order:
 *   post:
 *     tags: [Payment]
 *     summary: Create a Razorpay order for selected plan
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [planId]
 *             properties:
 *               planId:
 *                 type: string
 *                 example: pro
 *     responses:
 *       200:
 *         description: Razorpay order created
 */
router.post(
  "/create-order",
  verifyToken,
  createOrderValidator,
  checkRequestValidation,
  asyncHandler(paymentController.createOrder)
);

/**
 * @openapi
 * /payment/verify:
 *   post:
 *     tags: [Payment]
 *     summary: Verify Razorpay payment signature and activate subscription
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [planId, razorpay_order_id, razorpay_payment_id, razorpay_signature]
 *             properties:
 *               planId:
 *                 type: string
 *               razorpay_order_id:
 *                 type: string
 *               razorpay_payment_id:
 *                 type: string
 *               razorpay_signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment verified
 */
router.post(
  "/verify",
  verifyToken,
  verifyPaymentValidator,
  checkRequestValidation,
  asyncHandler(paymentController.verifyPayment)
);

/**
 * @openapi
 * /payment/history:
 *   get:
 *     tags: [Payment]
 *     summary: Get authenticated user payment history
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment history list
 */
router.get("/history", verifyToken, asyncHandler(paymentController.paymentHistory));

/**
 * @openapi
 * /payment/subscription:
 *   get:
 *     tags: [Payment]
 *     summary: Get authenticated user subscription details
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription details
 */
router.get("/subscription", verifyToken, asyncHandler(paymentController.subscription));

/**
 * @openapi
 * /payment/webhook:
 *   post:
 *     tags: [Payment]
 *     summary: Razorpay webhook endpoint
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook accepted
 */
router.post(
  "/webhook",
  asyncHandler(paymentController.webhook)
);

export default router;
