import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import v2Routes from "../modules/v2/v2.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/v2", v2Routes);

export default router;
