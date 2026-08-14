/**
 * V2 career progress Express routes.
 */

import { Router } from 'express';
import { asyncHandler } from '../../middleware/async.middleware';
import { sendSuccess } from '../../shared/responses';
import * as careerProgressService from '../../services/career-progress.service';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await careerProgressService.getCareerProgress(req.user!.uid);
    sendSuccess(res, result, 'Career progress fetched');
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const result = await careerProgressService.refreshCareerProgressForUser(req.user!.uid);
    sendSuccess(res, result, 'Career progress refreshed');
  }),
);

export default router;
