import { NextFunction, Request, Response, Router } from "express";
import verifyToken from "../../middleware/auth.middleware";
import * as atsController from "./atsController";
import { sendCreated, sendSuccess } from "../../shared/responses";
import { validate } from "../../middleware/validation.middleware";
import {
  analysisIdParamSchema,
  analyzeResumeSchema,
  historyQuerySchema,
} from "./ats.validators";

const router = Router();
router.use(verifyToken);

router.get(
  "/roles",
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const roles = await atsController.getAvailableRoles();
      sendSuccess(res, roles);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/analyze",
  validate(analyzeResumeSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await atsController.analyzeResume(
        req.user!.uid,
        req.body.resumeText,
        req.body.jobDescription,
        req.body.parsedResume,
        req.body.targetRole,
      );
      sendCreated(res, result, "Resume analyzed successfully");
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
      const limit = Number(req.query.limit) || 10;
      const results = await atsController.getHistory(req.user!.uid, limit);
      sendSuccess(res, results);
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