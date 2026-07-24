/**
 * Callable: uploadResume — thin wrapper over resume.service.
 */

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { toHttpsError } from '../services/errors';
import * as resumeService from '../services/resume.service';
import { requireAuth } from '../utils/callable-auth';

const requestSchema = z.object({
  storagePath: z.string().min(1),
  fileName: z.string().min(1),
  targetRole: z.string().min(1),
  resumeId: z.string().optional(),
});

export const uploadResume = onCall(
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
      return await resumeService.uploadResume(uid, parsed.data);
    } catch (err) {
      throw toHttpsError(err);
    }
  },
);
