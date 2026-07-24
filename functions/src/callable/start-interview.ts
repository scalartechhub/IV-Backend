/**
 * Callable: startInterview — thin wrapper over interview.service.
 */

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import * as interviewService from '../services/interview.service';
import { toHttpsError } from '../services/errors';
import { requireAuth } from '../utils/callable-auth';

const configSchema = z.object({
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
    .default('conversational'),
});

export const startInterview = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 60 },
  async (request) => {
    try {
      const uid = requireAuth(request);
      const parsed = configSchema.safeParse(request.data?.config ?? request.data);
      if (!parsed.success) {
        throw new HttpsError(
          'invalid-argument',
          `Invalid InterviewConfig: ${parsed.error.message}`,
        );
      }
      return await interviewService.startInterview(uid, parsed.data);
    } catch (err) {
      throw toHttpsError(err);
    }
  },
);
