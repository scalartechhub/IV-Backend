/**
 * V2 achievements Express routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.middleware';
import { validate } from '../../middleware/validation.middleware';
import { sendSuccess } from '../../shared/responses';
import * as achievementService from '../../services/achievement.service';

const router = Router();

const checkBodySchema = z.object({
  overallScore: z.number().min(0).max(100).optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await achievementService.listAchievements(req.user!.uid);
    sendSuccess(res, result, 'Achievements fetched');
  }),
);

router.post(
  '/check',
  validate(checkBodySchema),
  asyncHandler(async (req, res) => {
    const unlocked = await achievementService.checkAchievements(
      req.user!.uid,
      req.body,
    );
    sendSuccess(res, { unlocked }, 'Achievements checked');
  }),
);

export default router;
