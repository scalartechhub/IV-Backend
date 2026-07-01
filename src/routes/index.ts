import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import interviewRoutes from "../modules/interview/interview.routes";
import chatRoutes from "../modules/chat/chat.routes";
import paymentRoutes from "./payment.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/interviews", interviewRoutes);
router.use("/chat", chatRoutes);
router.use("/payment", paymentRoutes);

export default router;
