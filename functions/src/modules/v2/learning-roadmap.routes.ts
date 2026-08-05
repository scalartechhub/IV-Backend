/**
 * V2 learning roadmap Express routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.middleware';
import { validate } from '../../middleware/validation.middleware';
import { sendCreated, sendSuccess } from '../../shared/responses';
import * as learningRoadmapService from '../../services/learning-roadmap.service';

const router = Router();

const generateBodySchema = z.object({
  technology: z.string().min(1),
});

const topicIdParamSchema = z.object({ topicId: z.string().min(1) });

router.post(
  '/generate',
  validate(generateBodySchema),
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.generateWeek1Roadmap(
      req.user!.uid,
      req.body.technology,
    );
    sendCreated(res, result, 'Learning roadmap ready');
  }),
);

router.get(
  '/active',
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.getActiveLearningRoadmap(
      req.user!.uid,
    );
    sendSuccess(res, result, 'Active learning roadmap fetched');
  }),
);

router.get(
  '/topics/:topicId/notes',
  validate(topicIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.getOrGenerateTopicNotes(
      req.user!.uid,
      String(req.params.topicId),
    );
    sendSuccess(res, result, 'Topic notes fetched');
  }),
);

router.patch(
  '/topics/:topicId/complete',
  validate(topicIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.markTopicComplete(
      req.user!.uid,
      String(req.params.topicId),
    );
    sendSuccess(res, result, 'Topic marked complete');
  }),
);

export default router;
