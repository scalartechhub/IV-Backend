import { Router } from "express";
import verifyToken from "../../middleware/auth.middleware";
import { asyncHandler } from "../../middleware/async.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as codingController from "../../modules/coding/coding.controller";
import { runCodeSchema, submitCodeSchema } from "../../modules/coding/coding.validation";

const router = Router();

router.use(verifyToken);

router.post("/run", validate(runCodeSchema), asyncHandler(codingController.runCode));
router.post("/submit", validate(submitCodeSchema), asyncHandler(codingController.submitCode));

export default router;
