import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import interviewRoutes from "../modules/interview/interview.routes";
import chatRoutes from "../modules/chat/chat.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/interviews", interviewRoutes);
router.use("/chat", chatRoutes);

export default router;
