/**
 * V2 reports Express routes — per-interview reports.
 * Page summary (`/summary`) was removed; the frontend reads weeklyStats from Firestore.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.middleware';
import { validate } from '../../middleware/validation.middleware';
import { sendSuccess } from '../../shared/responses';
import * as reportsService from '../../services/reports.service';

const router = Router();

const idParamSchema = z.object({ id: z.string().min(1) });

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
});

router.get(
  '/',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listQuerySchema>;
    const result = await reportsService.listReports(req.user!.uid, q.limit);
    sendSuccess(res, result, 'Reports fetched');
  }),
);

router.get(
  '/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const result = await reportsService.getReport(
      req.user!.uid,
      String(req.params.id),
    );
    sendSuccess(res, result, 'Report fetched');
  }),
);

export default router;
