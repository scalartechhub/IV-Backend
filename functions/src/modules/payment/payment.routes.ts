import { Router } from "express";
import verifyToken from "../../middleware/auth.middleware";
import { asyncHandler } from "../../middleware/async.middleware";
import { checkRequestValidation } from "../../middleware/request-validation.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as paymentController from "./payment.controller";
import {
  createOrderValidator,
  verifyPaymentValidator,
  paymentHistoryQuerySchema,
} from "./payment.validation";

const router = Router();

router.post(
  "/create-order",
  verifyToken,
  createOrderValidator,
  checkRequestValidation,
  asyncHandler(paymentController.createOrder)
);

router.post(
  "/verify",
  verifyToken,
  verifyPaymentValidator,
  checkRequestValidation,
  asyncHandler(paymentController.verifyPayment)
);

router.get(
  "/history",
  verifyToken,
  validate(paymentHistoryQuerySchema, "query"),
  asyncHandler(paymentController.paymentHistory)
);

router.get("/subscription", verifyToken, asyncHandler(paymentController.subscription));

router.post("/webhook", asyncHandler(paymentController.webhook));

export default router;
