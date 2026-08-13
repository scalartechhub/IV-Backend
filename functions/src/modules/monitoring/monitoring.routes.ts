import { Router } from "express";
import rateLimit from "express-rate-limit";
import verifyToken from "../../middleware/auth.middleware";
import { asyncHandler } from "../../middleware/async.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./monitoring.controller";
import { endInterviewMonitoringSchema, monitoringEventSchema, monitoringInterviewParamSchema, monitoringViolationSchema, qualitySnapshotSchema, startInterviewMonitoringSchema } from "./monitoring.validation";

const router = Router();
const monitoringLimiter = rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many monitoring requests. Please slow down." } });
router.use(verifyToken, monitoringLimiter);
router.post("/start", validate(startInterviewMonitoringSchema), asyncHandler(controller.start));
router.post("/end", validate(endInterviewMonitoringSchema), asyncHandler(controller.end));
router.post("/monitoring/quality", validate(qualitySnapshotSchema), asyncHandler(controller.quality));
router.post("/monitoring/event", validate(monitoringEventSchema), asyncHandler(controller.event));
router.post("/monitoring/violation", validate(monitoringViolationSchema), asyncHandler(controller.violation));
router.get("/:interviewId/monitoring", validate(monitoringInterviewParamSchema, "params"), asyncHandler(controller.report));
export default router;
