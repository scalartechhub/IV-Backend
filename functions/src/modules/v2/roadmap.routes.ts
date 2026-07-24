/**
 * V2 roadmap Express routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.middleware';
import { validate } from '../../middleware/validation.middleware';
import { sendCreated, sendSuccess } from '../../shared/responses';
import * as roadmapService from '../../services/roadmap.service';

const router = Router();

const regenerateBodySchema = z.object({
  targetRole: z.string().optional(),
});

router.post(
  '/regenerate',
  validate(regenerateBodySchema),
  asyncHandler(async (req, res) => {
    const result = await roadmapService.regenerateRoadmap(
      req.user!.uid,
      req.body,
    );
    sendCreated(res, result, 'Roadmap regenerated');
  }),
);

router.get(
  '/active',
  asyncHandler(async (req, res) => {
    const result = await roadmapService.getActiveRoadmap(req.user!.uid);
    sendSuccess(res, result, 'Active roadmap fetched');
  }),
);

export default router;
