/**
 * Callable: completeInterview — thin wrapper over interview.service.
 */

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import * as interviewService from '../services/interview.service';
import { toHttpsError } from '../services/errors';
import { requireAuth } from '../utils/callable-auth';

const requestSchema = z.object({
  interviewId: z.string().min(1),
  transcriptSummary: z.string().min(1),
  durationSec: z.number().nonnegative(),
  endReason: z.enum([
    'time_expired',
    'user_ended',
    'connection_lost',
    'max_questions_signal',
  ]),
});

export const completeInterview = onCall(
  {
    region: 'us-central1',
    memory: '1GiB',
    timeoutSeconds: 180,
    secrets: ['GEMINI_API_KEY'],
  },
  async (request) => {
    try {
      const uid = requireAuth(request);
      const parsed = requestSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new HttpsError(
          'invalid-argument',
          `Invalid request: ${parsed.error.message}`,
        );
      }
      return await interviewService.completeInterview(uid, parsed.data);
    } catch (err) {
      throw toHttpsError(err);
    }
  },
);
