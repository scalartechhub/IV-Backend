import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import verifyToken from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validation.middleware";
import { sendSuccess } from "../../shared/responses";
import * as atsController from "../../modules/ats-scoring/atsController";

const router = Router();

const analyzeResumeSchema = z.object({
  resumeText: z
    .string()
    .trim()
    .min(100, "Resume text is too short (min 100 characters)")
    .max(15_000, "Resume text is too long (max 15,000 characters)"),
  jobDescription: z
    .string()
    .trim()
    .min(100, "Job description is too short (min 100 characters)")
    .max(15_000, "Job description is too long (max 15,000 characters)"),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const analysisIdParamSchema = z.object({
  id: z.string().trim().min(1, "Analysis ID is required"),
});

// Apply auth to all routes in this file
router.use(verifyToken);

router.post(
  "/analyze",
  validate(analyzeResumeSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await atsController.analyzeResume(
        req.user!.uid,
        req.body.resumeText,
        req.body.jobDescription,
      );
      sendSuccess(res, result, "Resume analyzed successfully");
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/history",
  validate(historyQuerySchema, "query"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await atsController.getHistory(
        req.user!.uid,
        Number(req.query.limit),
      );
      sendSuccess(res, { analyses: result, total: result.length });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/:id",
  validate(analysisIdParamSchema, "params"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await atsController.getAnalysisById(
        req.user!.uid,
        String(req.params.id),
      );
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/:id",
  validate(analysisIdParamSchema, "params"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await atsController.deleteAnalysis(req.user!.uid, String(req.params.id));
      sendSuccess(res, null, "Analysis deleted successfully");
    } catch (error) {
      next(error);
    }
  },
);

export default router;