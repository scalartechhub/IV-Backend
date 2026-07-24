/**
 * V2 coding Express routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.middleware';
import { validate } from '../../middleware/validation.middleware';
import { sendCreated } from '../../shared/responses';
import * as codingService from '../../services/coding.service';

const router = Router();

const submitBodySchema = z.object({
  interviewId: z.string().min(1),
  problemId: z.string().min(1),
  code: z.string().min(1),
  language: z.string().min(1),
});

router.post(
  '/submit',
  validate(submitBodySchema),
  asyncHandler(async (req, res) => {
    const result = await codingService.submitCodingSolution(
      req.user!.uid,
      req.body,
    );
    sendCreated(res, result, 'Coding solution submitted');
  }),
);

export default router;
