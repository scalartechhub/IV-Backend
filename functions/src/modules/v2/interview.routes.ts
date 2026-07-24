/**
 * V2 interview Express routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.middleware';
import { validate } from '../../middleware/validation.middleware';
import { sendCreated, sendSuccess } from '../../shared/responses';
import * as interviewService from '../../services/interview.service';

const router = Router();

const startBodySchema = z.object({
  topic: z.string().optional(),
  company: z.string().optional(),
  skills: z.array(z.string()),
  technologies: z.array(z.string()),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  durationMinutes: z.number().positive(),
  resumeVersionUsed: z.string().optional(),
  currentRole: z.string(),
  targetRole: z.string(),
  sourceRoadmapActivityId: z.string().optional(),
  mode: z
    .enum(['conversational', 'coding', 'behavioral', 'system_design'])
    .optional(),
});

const completeBodySchema = z.object({
  transcriptSummary: z.string().min(1),
  durationSec: z.number().nonnegative(),
  endReason: z.enum([
    'time_expired',
    'user_ended',
    'connection_lost',
    'max_questions_signal',
  ]),
});

const idParamSchema = z.object({ id: z.string().min(1) });

const listQuerySchema = z.object({
  status: z
    .enum([
      'created',
      'device_check',
      'in_progress',
      'completed',
      'abandoned',
      'expired',
    ])
    .optional(),
  mode: z
    .enum(['conversational', 'coding', 'behavioral', 'system_design'])
    .optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

router.post(
  '/start',
  validate(startBodySchema),
  asyncHandler(async (req, res) => {
    const result = await interviewService.startInterview(req.user!.uid, req.body);
    sendCreated(res, result, 'Interview started');
  }),
);

router.post(
  '/:id/complete',
  validate(idParamSchema, 'params'),
  validate(completeBodySchema),
  asyncHandler(async (req, res) => {
    const result = await interviewService.completeInterview(req.user!.uid, {
      interviewId: String(req.params.id),
      ...req.body,
    });
    sendSuccess(res, result, 'Interview completed');
  }),
);

router.get(
  '/',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listQuerySchema>;
    const result = await interviewService.listInterviews(req.user!.uid, q);
    sendSuccess(res, result, 'Interviews fetched');
  }),
);

router.get(
  '/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const result = await interviewService.getInterview(
      req.user!.uid,
      String(req.params.id),
    );
    sendSuccess(res, result, 'Interview fetched');
  }),
);

export default router;
