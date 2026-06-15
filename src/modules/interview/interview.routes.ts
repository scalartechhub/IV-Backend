import { Router } from "express";
import * as interviewController from "./interview.controller";
import verifyToken from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validation.middleware";
import { requirePdfUpload } from "../../middleware/upload.middleware";
import { createInterviewSchema, submitAnswerSchema } from "./interview.validation";

const router = Router();

router.use(verifyToken);

router.post("/create", validate(createInterviewSchema), interviewController.createInterview);
router.get("/", interviewController.listInterviews);
router.get("/:id", interviewController.getInterview);

router.post("/:id/resume", requirePdfUpload, interviewController.uploadResume);
router.post("/:id/jd", requirePdfUpload, interviewController.uploadJD);

router.post("/:id/generate-questions", interviewController.generateQuestions);
router.get("/:id/questions", interviewController.getQuestions);

router.post("/:id/answer", validate(submitAnswerSchema), interviewController.submitAnswer);
router.post("/:id/finish", interviewController.finishInterview);
router.get("/:id/report", interviewController.getReport);

export default router;
