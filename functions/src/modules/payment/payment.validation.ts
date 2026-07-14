import { body } from "express-validator";
import { z } from "zod";

export const createOrderValidator = [
  body("planId")
    .exists({ values: "falsy" })
    .withMessage("planId is required")
    .isString()
    .withMessage("planId must be a string")
    .trim()
    .notEmpty()
    .withMessage("planId cannot be empty"),
];

export const verifyPaymentValidator = [
  body("planId")
    .exists({ values: "falsy" })
    .withMessage("planId is required")
    .isString()
    .withMessage("planId must be a string"),
  body("razorpay_order_id")
    .exists({ values: "falsy" })
    .withMessage("razorpay_order_id is required")
    .isString()
    .withMessage("razorpay_order_id must be a string"),
  body("razorpay_payment_id")
    .exists({ values: "falsy" })
    .withMessage("razorpay_payment_id is required")
    .isString()
    .withMessage("razorpay_payment_id must be a string"),
  body("razorpay_signature")
    .exists({ values: "falsy" })
    .withMessage("razorpay_signature is required")
    .isString()
    .withMessage("razorpay_signature must be a string"),
];

export const paymentHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  startAfter: z.string().min(1).optional(),
});

export type PaymentHistoryQuery = z.infer<typeof paymentHistoryQuerySchema>;
