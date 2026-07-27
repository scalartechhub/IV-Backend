/**
 * Callable: startInterview — thin wrapper over interview.service.
 * Accepts full config OR Practice shortcuts (templateId / companyId / quickStart).
 */

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import * as interviewService from '../services/interview.service';
import { toHttpsError } from '../services/errors';
import { requireAuth } from '../utils/callable-auth';

const startSchema = z
  .object({
    topic: z.string().optional(),
    company: z.string().optional(),
    skills: z.array(z.string()).optional(),
    technologies: z.array(z.string()).optional(),
    difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
    durationMinutes: z.number().positive().optional(),
    resumeVersionUsed: z.string().optional(),
    currentRole: z.string().optional(),
    targetRole: z.string().optional(),
    sourceRoadmapActivityId: z.string().optional(),
    mode: z
      .enum(['conversational', 'coding', 'behavioral', 'system_design'])
      .optional(),
    templateId: z.string().min(1).optional(),
    companyId: z.string().min(1).optional(),
    quickStart: z.boolean().optional(),
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
        message: 'difficulty required without shortcut',
        path: ['difficulty'],
      });
    }
    if (data.durationMinutes === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'durationMinutes required without shortcut',
        path: ['durationMinutes'],
      });
    }
    if (!data.currentRole || !data.targetRole) {
      ctx.addIssue({
        code: 'custom',
        message: 'currentRole and targetRole required without shortcut',
        path: ['currentRole'],
      });
    }
  });

export const startInterview = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 60 },
  async (request) => {
    try {
      const uid = requireAuth(request);
      const raw = request.data?.config ?? request.data;
      const parsed = startSchema.safeParse(raw);
      if (!parsed.success) {
        throw new HttpsError(
          'invalid-argument',
          `Invalid start payload: ${parsed.error.message}`,
        );
      }
      return await interviewService.startInterview(uid, parsed.data);
    } catch (err) {
      throw toHttpsError(err);
    }
  },
);
