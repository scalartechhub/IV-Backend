/**
 * V2 onboarding Express routes.
 *
 * POST /v2/onboarding/analyze-from-answers
 *   JSON body: questionnaire answers → interview-prep plan
 *   Writes users/{uid}/onboarding/analysis (source: questions)
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.middleware';
import { AppError } from '../../shared/utils';
import { sendCreated } from '../../shared/responses';
import * as onboardingService from '../../services/onboarding.service';

const router = Router();

const analyzeFromAnswersSchema = z.object({
  journeyStageId: z.string().min(1),
  journeyStageLabel: z.string().optional(),
  domainId: z.string().min(1),
  domainLabel: z.string().optional(),
  roleId: z.string().min(1),
  roleLabel: z.string().min(1),
  experienceBucketId: z.string().min(1),
  experienceLabel: z.string().optional(),
  education: z.string().optional(),
  targetRoleIds: z.array(z.string()).optional(),
  targetRoleLabels: z.array(z.string()).optional(),
  targetCompanies: z.array(z.string()).optional(),
  learningInterestIds: z.array(z.string()).optional(),
  learningInterestLabels: z.array(z.string()).optional(),
});

router.post(
  '/analyze-from-answers',
  asyncHandler(async (req, res) => {
    const parsed = analyzeFromAnswersSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        400,
        `Invalid answers payload: ${parsed.error.message}`,
      );
    }

    const result = await onboardingService.analyzeFromAnswers(
      req.user!.uid,
      parsed.data,
    );

    sendCreated(
      res,
      result,
      result.onboardingPreserved
        ? 'Existing onboarding analysis preserved'
        : 'Onboarding analysis generated from answers successfully',
    );
  }),
);

export default router;
