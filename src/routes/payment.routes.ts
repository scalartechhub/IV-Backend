import { Router } from "express";
import verifyToken from "../middleware/auth.middleware";
import { asyncHandler } from "../middleware/async.middleware";
import { checkRequestValidation } from "../middleware/request-validation.middleware";
import * as paymentController from "../controllers/payment.controller";
import { createOrderValidator, verifyPaymentValidator } from "../validators/payment.validator";

const router = Router();

router.post(
  "/create-order",
  verifyToken,
  createOrderValidator,
  checkRequestValidation,
  asyncHandler(paymentController.createOrder),
);

router.post(
  "/verify",
  verifyToken,
  verifyPaymentValidator,
  checkRequestValidation,
  asyncHandler(paymentController.verifyPayment)
);

router.get("/history", verifyToken, asyncHandler(paymentController.paymentHistory));

router.get("/subscription", verifyToken, asyncHandler(paymentController.subscription));

router.post(
  "/webhook",
  asyncHandler(paymentController.webhook)
);

export default router;
