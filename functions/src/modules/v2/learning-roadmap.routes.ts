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

const subtopicIdParamSchema = z.object({ subtopicId: z.string().min(1) });
const quizIdParamSchema = z.object({ quizId: z.string().min(1) });
const submitQuizBodySchema = z.object({
  answers: z.record(z.string(), z.string()),
});

router.post(
  '/generate',
  validate(generateBodySchema),
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.generateRoadmap(
      req.user!.uid,
      req.body.technology,
    );
    sendCreated(res, result, 'Learning roadmap ready');
  }),
);

router.get(
  '/active',
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.getActiveRoadmap(req.user!.uid);
    sendSuccess(res, result, 'Active learning roadmap fetched');
  }),
);

router.get(
  '/subtopics/:subtopicId/notes',
  validate(subtopicIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.getOrGenerateSubtopicNotes(
      req.user!.uid,
      String(req.params.subtopicId),
    );
    sendSuccess(res, result, 'Subtopic notes fetched');
  }),
);

router.patch(
  '/topics/:subtopicId/complete',
  validate(subtopicIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.markSubtopicComplete(
      req.user!.uid,
      String(req.params.subtopicId),
    );
    sendSuccess(res, result, 'Topic marked complete');
  }),
);

router.get(
  '/quizzes/:quizId',
  validate(quizIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.getOrGenerateQuiz(
      req.user!.uid,
      String(req.params.quizId),
    );
    sendSuccess(res, result, 'Quiz fetched');
  }),
);

router.post(
  '/quizzes/:quizId/submit',
  validate(quizIdParamSchema, 'params'),
  validate(submitQuizBodySchema),
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.submitQuiz(
      req.user!.uid,
      String(req.params.quizId),
      req.body.answers,
    );
    sendSuccess(res, result, 'Quiz submitted');
  }),
);

export default router;
