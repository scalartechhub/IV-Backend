import { Router } from "express";
import * as interviewController from "./interview.controller";
import verifyToken from "../../middleware/auth.middleware";
import { asyncHandler } from "../../middleware/async.middleware";
import { validate } from "../../middleware/validation.middleware";
import { requirePdfUpload } from "../../middleware/upload.middleware";
import {
  createInterviewSchema,
  submitAnswerSchema,
  interviewIdParamSchema,
} from "./interview.validation";

const router = Router();

router.use(verifyToken);

router.post("/create", validate(createInterviewSchema), asyncHandler(interviewController.createInterview));

router.post(
  "/resume-analysis",
  requirePdfUpload,
  asyncHandler(interviewController.resumeAnalysis)
);

router.post(
  "/:id/resume",
  validate(interviewIdParamSchema, "params"),
  requirePdfUpload,
  asyncHandler(interviewController.uploadResume)
);
router.post(
  "/:id/jd",
  validate(interviewIdParamSchema, "params"),
  requirePdfUpload,
  asyncHandler(interviewController.uploadJD)
);

router.post(
  "/:id/generate-questions",
  validate(interviewIdParamSchema, "params"),
  asyncHandler(interviewController.generateQuestions)
);

router.post(
  "/:id/answer",
  validate(interviewIdParamSchema, "params"),
  validate(submitAnswerSchema),
  asyncHandler(interviewController.submitAnswers)
);
router.post(
  "/:id/finish",
  validate(interviewIdParamSchema, "params"),
  asyncHandler(interviewController.finishInterview)
);

export default router;
