import { Router } from "express";
import * as interviewController from "./interview.controller";
import verifyToken from "../../middleware/auth.middleware";
import { asyncHandler } from "../../middleware/async.middleware";
import { validate } from "../../middleware/validation.middleware";
import { requirePdfUpload } from "../../middleware/upload.middleware";
import {
  createInterviewSchema,
  submitAnswerSchema,
  listInterviewsQuerySchema,
  interviewIdParamSchema,
} from "./interview.validation";

const router = Router();

router.use(verifyToken);

router.post("/create", validate(createInterviewSchema), asyncHandler(interviewController.createInterview));
router.get("/", validate(listInterviewsQuerySchema, "query"), asyncHandler(interviewController.listInterviews));
router.get("/:id", validate(interviewIdParamSchema, "params"), asyncHandler(interviewController.getInterview));

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
router.get(
  "/:id/questions",
  validate(interviewIdParamSchema, "params"),
  asyncHandler(interviewController.getQuestions)
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
router.get(
  "/:id/report",
  validate(interviewIdParamSchema, "params"),
  asyncHandler(interviewController.getReport)
);

export default router;
