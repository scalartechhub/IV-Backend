import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import interviewRoutes from "../modules/interview/interview.routes";
import chatRoutes from "../modules/chat/chat.routes";
import chatBotRoutes from "../modules/chat-bot/chat-bot.routes";
import paymentRoutes from "../modules/payment/payment.routes";
import emailRoutes, { contactLimiter } from "../modules/email/email.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/interviews", interviewRoutes);
router.use("/chat", chatRoutes);
router.use("/chat-bot", chatBotRoutes);
router.use("/payment", paymentRoutes);
router.use("/contact", contactLimiter, emailRoutes);

export default router;
