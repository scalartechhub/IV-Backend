/**
 * Callable: saveProfileSettings — thin wrapper over profile.service.
 */

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { toHttpsError } from '../services/errors';
import * as profileService from '../services/profile.service';
import { requireAuth } from '../utils/callable-auth';

const requestSchema = z.object({
  profile: z
    .object({
      currentRole: z.string().optional(),
      yearsExperience: z.number().optional(),
      targetRole: z.string().optional(),
      targetCompanies: z.array(z.string()).optional(),
      location: z.string().optional(),
    })
    .optional(),
  preferences: z
    .object({
      dailyReminders: z.boolean().optional(),
      aiVoiceFeedback: z.boolean().optional(),
      focusMode: z.boolean().optional(),
      weeklyProgressEmail: z.boolean().optional(),
      darkMode: z.boolean().optional(),
    })
    .optional(),
  displayName: z.string().optional(),
});

export const saveProfileSettings = onCall(
  { region: 'us-central1' },
  async (request) => {
    try {
      const uid = requireAuth(request);
      const parsed = requestSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new HttpsError('invalid-argument', parsed.error.message);
      }
      return await profileService.saveProfileSettings(uid, parsed.data);
    } catch (err) {
      throw toHttpsError(err);
    }
  },
);
