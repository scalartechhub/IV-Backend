/**
 * Callable: submitCodingSolution — thin wrapper over coding.service.
 */

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import * as codingService from '../services/coding.service';
import { toHttpsError } from '../services/errors';
import { requireAuth } from '../utils/callable-auth';

const requestSchema = z.object({
  interviewId: z.string().min(1),
  problemId: z.string().min(1),
  code: z.string().min(1),
  language: z.string().min(1),
});

export const submitCodingSolution = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
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
      return await codingService.submitCodingSolution(uid, parsed.data);
    } catch (err) {
      throw toHttpsError(err);
    }
  },
);
