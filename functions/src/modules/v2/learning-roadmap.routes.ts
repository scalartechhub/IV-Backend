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
  level: z.string().min(1).optional(),
});

const roadmapIdParamSchema = z.object({ roadmapId: z.string().min(1) });
const subtopicIdParamSchema = z.object({
  roadmapId: z.string().min(1),
  subtopicId: z.string().min(1),
});
const quizIdParamSchema = z.object({
  roadmapId: z.string().min(1),
  quizId: z.string().min(1),
});
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
      req.body.level,
    );
    sendCreated(
      res,
      result,
      result.reused ? 'You already have a roadmap for this technology' : 'Learning roadmap ready',
    );
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.listRoadmaps(req.user!.uid);
    sendSuccess(res, result, 'Learning roadmaps fetched');
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
  '/:roadmapId',
  validate(roadmapIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.getRoadmapById(
      req.user!.uid,
      String(req.params.roadmapId),
    );
    sendSuccess(res, result, 'Learning roadmap fetched');
  }),
);

router.patch(
  '/:roadmapId/activate',
  validate(roadmapIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.activateRoadmap(
      req.user!.uid,
      String(req.params.roadmapId),
    );
    sendSuccess(res, result, 'Learning roadmap activated');
  }),
);

// Deletion is handled directly from the client via the Firestore SDK (the owner has
// delete rights on their own users/{uid}/learningRoadmap/{roadmapId} docs) — no backend
// route needed.

router.get(
  '/:roadmapId/subtopics/:subtopicId/notes',
  validate(subtopicIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.getOrGenerateSubtopicNotes(
      req.user!.uid,
      String(req.params.roadmapId),
      String(req.params.subtopicId),
    );
    sendSuccess(res, result, 'Subtopic notes fetched');
  }),
);

router.patch(
  '/:roadmapId/topics/:subtopicId/complete',
  validate(subtopicIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.markSubtopicComplete(
      req.user!.uid,
      String(req.params.roadmapId),
      String(req.params.subtopicId),
    );
    sendSuccess(res, result, 'Topic marked complete');
  }),
);

router.get(
  '/:roadmapId/quizzes/:quizId',
  validate(quizIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.getOrGenerateQuiz(
      req.user!.uid,
      String(req.params.roadmapId),
      String(req.params.quizId),
    );
    sendSuccess(res, result, 'Quiz fetched');
  }),
);

router.post(
  '/:roadmapId/quizzes/:quizId/submit',
  validate(quizIdParamSchema, 'params'),
  validate(submitQuizBodySchema),
  asyncHandler(async (req, res) => {
    const result = await learningRoadmapService.submitQuiz(
      req.user!.uid,
      String(req.params.roadmapId),
      String(req.params.quizId),
      req.body.answers,
    );
    sendSuccess(res, result, 'Quiz submitted');
  }),
);

export default router;
