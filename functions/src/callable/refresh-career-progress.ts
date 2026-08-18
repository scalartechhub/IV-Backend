/**
 * Callable: refreshCareerProgress — recompute career progress on demand.
 */

import { onCall } from 'firebase-functions/v2/https';
import { toHttpsError } from '../services/errors';
import { refreshCareerProgressForUser } from '../services/career-progress.service';
import { requireAuth } from '../utils/callable-auth';

export const refreshCareerProgress = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (request) => {
    try {
      const uid = requireAuth(request);
      const progress = await refreshCareerProgressForUser(uid);
      return { progress };
    } catch (err) {
      throw toHttpsError(err);
    }
  },
);
