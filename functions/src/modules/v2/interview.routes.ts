/**
 * V2 interview Express routes.
 * Supports Practice UI start modes: templateId / companyId / quickStart.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.middleware';
import { validate } from '../../middleware/validation.middleware';
import { sendCreated, sendSuccess } from '../../shared/responses';
import * as interviewService from '../../services/interview.service';
import * as jdAnalysisService from '../../services/jd-analysis.service';
import { assertInterviewQuota, recordInterviewUsage } from '../subscription/feature-access.service';

const router = Router();

const interviewModeSchema = z.enum([
  'conversational',
  'coding',
  'behavioral',
  'system_design',
  'hr',
]);

const difficultySchema = z.enum(['easy', 'medium', 'hard']);

const focusAreasSchema = z.object({
  technical: z.boolean(),
  coding: z.boolean(),
  behavioral: z.boolean(),
  problemSolving: z.boolean(),
  communication: z.boolean(),
});

const startBodySchema = z
  .object({
    topic: z.string().optional(),
    company: z.string().optional(),
    skills: z.array(z.string()).optional(),
    technologies: z.array(z.string()).optional(),
    difficulty: difficultySchema.optional(),
    durationMinutes: z.number().positive().optional(),
    resumeVersionUsed: z.string().optional(),
    currentRole: z.string().optional(),
    targetRole: z.string().optional(),
    sourceRoadmapActivityId: z.string().optional(),
    mode: interviewModeSchema.optional(),
    templateId: z.string().min(1).optional(),
    companyId: z.string().min(1).optional(),
    quickStart: z.boolean().optional(),
    jobDescriptionText: z.string().max(25000).optional(),
    focusAreas: focusAreasSchema.optional(),
  })
  .superRefine((data, ctx) => {
    const hasShortcut =
      Boolean(data.templateId) ||
      Boolean(data.companyId) ||
      data.quickStart === true;

    if (hasShortcut) return;

    if (!data.difficulty) {
      ctx.addIssue({
        code: 'custom',
        message: 'difficulty is required unless templateId, companyId, or quickStart is set',
        path: ['difficulty'],
      });
    }
    if (data.durationMinutes === undefined) {
      ctx.addIssue({
        code: 'custom',
        message:
          'durationMinutes is required unless templateId, companyId, or quickStart is set',
        path: ['durationMinutes'],
      });
    }
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
  mode: interviewModeSchema.optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

const statusBodySchema = z.object({
  status: z.enum(['created', 'device_check', 'in_progress', 'abandoned', 'expired']),
});

const environmentBodySchema = z.object({
  audioEnabled: z.boolean().optional(),
  cameraEnabled: z.boolean().optional(),
  browser: z.string().optional(),
  os: z.string().optional(),
  internetQualityMbps: z.number().nonnegative().optional(),
});

const analyzeJdBodySchema = z.object({
  jdText: z.string().min(30).max(25000),
  company: z.string().optional(),
  targetRole: z.string().optional(),
  experienceLevel: z.string().optional(),
  interviewType: interviewModeSchema.optional(),
  difficulty: difficultySchema.optional(),
  durationMinutes: z.number().positive().optional(),
});

const ocrJdBodySchema = z.object({
  fileBase64: z.string().min(1),
  fileName: z.string().optional(),
  mimeType: z.string().optional(),
});

router.post(
  '/analyze-jd',
  validate(analyzeJdBodySchema),
  asyncHandler(async (req, res) => {
    const { jdText, ...context } = req.body as z.infer<typeof analyzeJdBodySchema>;
    const result = await jdAnalysisService.analyzeJobDescription(jdText, context);
    sendSuccess(res, result, 'Job description analyzed');
  }),
);

router.post(
  '/ocr-jd',
  validate(ocrJdBodySchema),
  asyncHandler(async (req, res) => {
    const result = await jdAnalysisService.ocrJobDescriptionImage(req.body);
    sendSuccess(res, result, 'Job description text extracted');
  }),
);

router.post(
  '/start',
  validate(startBodySchema),
  asyncHandler(async (req, res) => {
    // Enforce monthly interview quota based on user's plan
    await assertInterviewQuota(req.user!.uid);
    const result = await interviewService.startInterview(req.user!.uid, req.body);
    // Record usage after successful creation
    await recordInterviewUsage(req.user!.uid);
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

router.patch(
  '/:id/status',
  validate(idParamSchema, 'params'),
  validate(statusBodySchema),
  asyncHandler(async (req, res) => {
    const result = await interviewService.updateInterviewStatus(
      req.user!.uid,
      String(req.params.id),
      req.body.status,
    );
    sendSuccess(res, result, 'Interview status updated');
  }),
);

router.patch(
  '/:id/environment',
  validate(idParamSchema, 'params'),
  validate(environmentBodySchema),
  asyncHandler(async (req, res) => {
    const result = await interviewService.updateInterviewEnvironment(
      req.user!.uid,
      String(req.params.id),
      req.body,
    );
    sendSuccess(res, result, 'Interview environment updated');
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
