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
  interviewIdParamSchema,
  listInterviewsQuerySchema,
} from "./interview.validation";

const router = Router();

router.use(verifyToken);

router.get(
  "/",
  validate(listInterviewsQuerySchema, "query"),
  asyncHandler(interviewController.listInterviews)
);

router.get(
  "/:id",
  validate(interviewIdParamSchema, "params"),
  asyncHandler(interviewController.getInterview)
);

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
  "/:id/finish",
  validate(interviewIdParamSchema, "params"),
  asyncHandler(interviewController.finishInterview)
);

export default router;
