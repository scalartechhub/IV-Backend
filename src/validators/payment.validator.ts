import { body } from "express-validator";

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
