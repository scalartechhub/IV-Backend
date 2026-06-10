import { Router } from "express";
import * as authController from "../controllers/auth.controller";
import verifyToken from "../middlewares/auth.middleware";

const router = Router();

router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/google", authController.googleLogin);
router.post("/github", authController.githubLogin);
router.post("/phone", authController.phoneLogin);

router.get("/me", verifyToken, authController.getCurrentUser);
router.post("/logout", verifyToken, authController.logout);

export default router;
