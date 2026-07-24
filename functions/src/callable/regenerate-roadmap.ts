/**
 * Callable: regenerateRoadmap — thin wrapper over roadmap.service.
 */

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { toHttpsError } from '../services/errors';
import * as roadmapService from '../services/roadmap.service';
import { requireAuth } from '../utils/callable-auth';

const requestSchema = z.object({
  targetRole: z.string().optional(),
});

export const regenerateRoadmap = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
    secrets: ['GEMINI_API_KEY'],
  },
  async (request) => {
    try {
      const uid = requireAuth(request);
      const parsed = requestSchema.safeParse(request.data ?? {});
      if (!parsed.success) {
        throw new HttpsError('invalid-argument', parsed.error.message);
      }
      return await roadmapService.regenerateRoadmap(uid, parsed.data);
    } catch (err) {
      throw toHttpsError(err);
    }
  },
);
