import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import interviewRoutes from "../modules/interview/interview.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/interviews", interviewRoutes);

export default router;
