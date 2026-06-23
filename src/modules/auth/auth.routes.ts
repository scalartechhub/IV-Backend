import { Router } from "express";
import * as authController from "./auth.controller";
import verifyToken from "../../middleware/auth.middleware";
import { asyncHandler } from "../../middleware/async.middleware";
import { validate } from "../../middleware/validation.middleware";
import { requirePdfUpload } from "../../middleware/upload.middleware";
import { registerSchema, loginSchema } from "./auth.validation";

const router = Router();

router.post("/register", validate(registerSchema), asyncHandler(authController.register));
router.post("/login", validate(loginSchema), asyncHandler(authController.login));

router.post("/logout", verifyToken, asyncHandler(authController.logout));
router.post(
  "/resume",
  verifyToken,
  requirePdfUpload,
  asyncHandler(authController.uploadResumeAnalysis)
);

export default router;
