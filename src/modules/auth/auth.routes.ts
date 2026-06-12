import { Router } from "express";
import * as authController from "./auth.controller";
import verifyToken from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validation.middleware";
import { registerSchema, loginSchema, oAuthTokenSchema } from "./auth.validation";

const router = Router();

router.post("/register", validate(registerSchema), authController.register);
router.post("/login", validate(loginSchema), authController.login);
router.post("/google", validate(oAuthTokenSchema), authController.googleLogin);
router.post("/github", validate(oAuthTokenSchema), authController.githubLogin);
router.post("/phone", validate(oAuthTokenSchema), authController.phoneLogin);

router.get("/me", verifyToken, authController.getCurrentUser);
router.post("/logout", verifyToken, authController.logout);

export default router;
