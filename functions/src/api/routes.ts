import { Router } from "express";
import atsRoutes from "../modules/ats-scoring/ats.route";
import authRoutes from "../modules/auth/auth.routes";
import chatBotRoutes from "../modules/chat-bot/chat-bot.routes";
import chatRoutes from "../modules/chat/chat.routes";
import emailRoutes, { contactLimiter } from "../modules/email/email.routes";
import interviewRoutes from "../modules/interview/interview.routes";
import paymentRoutes from "../modules/payment/payment.routes";
import v2Routes from "../modules/v2/v2.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/v2", v2Routes);
router.use("/interviews", interviewRoutes);
router.use("/chat", chatRoutes);
router.use("/chat-bot", chatBotRoutes);
router.use("/payment", paymentRoutes);
router.use("/ats", atsRoutes);
router.use("/contact", contactLimiter, emailRoutes);

export default router;
