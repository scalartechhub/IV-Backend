/**
 * V2 practice Express routes — catalog for /practice UI.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.middleware';
import { validate } from '../../middleware/validation.middleware';
import { sendSuccess } from '../../shared/responses';
import * as practiceService from '../../services/practice.service';

const router = Router();

const catalogQuerySchema = z.object({
  q: z.string().optional(),
  categoryId: z.string().optional(),
});

router.get(
  '/catalog',
  validate(catalogQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof catalogQuerySchema>;
    const result = await practiceService.getPracticeCatalog(req.user!.uid, q);
    sendSuccess(res, result, 'Practice catalog fetched');
  }),
);

export default router;
