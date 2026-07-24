/**
 * V2 profile Express routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.middleware';
import { validate } from '../../middleware/validation.middleware';
import { sendSuccess } from '../../shared/responses';
import * as profileService from '../../services/profile.service';

const router = Router();

const settingsBodySchema = z.object({
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

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await profileService.getProfile(req.user!.uid);
    sendSuccess(res, result, 'Profile fetched');
  }),
);

router.patch(
  '/settings',
  validate(settingsBodySchema),
  asyncHandler(async (req, res) => {
    const result = await profileService.saveProfileSettings(
      req.user!.uid,
      req.body,
    );
    sendSuccess(res, result, 'Settings saved');
  }),
);

export default router;
