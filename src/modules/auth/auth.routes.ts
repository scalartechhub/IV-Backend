import { Router } from "express";
import * as authController from "./auth.controller";
import verifyToken from "../../middleware/auth.middleware";
import { asyncHandler } from "../../middleware/async.middleware";
import { validate } from "../../middleware/validation.middleware";
import { registerSchema, loginSchema } from "./auth.validation";

const router = Router();

router.post("/register", validate(registerSchema), asyncHandler(authController.register));
router.post("/login", validate(loginSchema), asyncHandler(authController.login));

router.get("/me", verifyToken, asyncHandler(authController.getCurrentUser));
router.post("/logout", verifyToken, asyncHandler(authController.logout));

export default router;
