import { Router } from "express";
import * as interviewController from "./interview.controller";
import verifyToken from "../../middleware/auth.middleware";
import { asyncHandler } from "../../middleware/async.middleware";
import { validate } from "../../middleware/validation.middleware";
import {
  requireInterviewDocumentsUpload,
  requirePdfUpload,
} from "../../middleware/upload.middleware";
import {
  createInterviewSchema,
  finishInterviewSchema,
  interviewIdParamSchema,
} from "./interview.validation";

const router = Router();

router.use(verifyToken);

router.post("/create", validate(createInterviewSchema), asyncHandler(interviewController.createInterview));

router.post(
  "/create-with-documents",
  requireInterviewDocumentsUpload,
  asyncHandler(interviewController.createInterviewWithDocuments)
);

router.post(
  "/resume-analysis",
  requirePdfUpload,
  asyncHandler(interviewController.resumeAnalysis)
);

router.post(
  "/:id/generate-questions",
  validate(interviewIdParamSchema, "params"),
  asyncHandler(interviewController.generateQuestions)
);

router.post(
  "/:id/finish",
  validate(interviewIdParamSchema, "params"),
  validate(finishInterviewSchema),
  asyncHandler(interviewController.finishInterview)
);

export default router;
