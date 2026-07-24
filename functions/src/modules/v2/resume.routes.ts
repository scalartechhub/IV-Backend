/**
 * V2 resume Express routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.middleware';
import { requirePdfUpload } from '../../middleware/upload.middleware';
import { validate } from '../../middleware/validation.middleware';
import { AppError } from '../../shared/utils';
import { sendCreated, sendSuccess } from '../../shared/responses';
import * as resumeService from '../../services/resume.service';

const router = Router();

const uploadBodySchema = z.object({
  storagePath: z.string().min(1),
  fileName: z.string().min(1),
  targetRole: z.string().min(1),
  resumeId: z.string().optional(),
});

router.post(
  '/analyze',
  requirePdfUpload,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(400, 'Resume PDF file is required (multipart field: file).');
    }

    const targetRoleRaw = req.body?.targetRole;
    const targetRole =
      typeof targetRoleRaw === 'string' && targetRoleRaw.trim().length > 0
        ? targetRoleRaw.trim()
        : 'Software Engineer';

    const result = await resumeService.analyzeResume(req.user!.uid, {
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname || 'resume.pdf',
      targetRole,
      contentType: req.file.mimetype,
    });
    sendCreated(res, result, 'Resume analyzed successfully');
  }),
);

router.post(
  '/upload',
  validate(uploadBodySchema),
  asyncHandler(async (req, res) => {
    const result = await resumeService.uploadResume(req.user!.uid, req.body);
    sendCreated(res, result, 'Resume uploaded and analyzed');
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await resumeService.listResumes(req.user!.uid);
    sendSuccess(res, result, 'Resumes fetched');
  }),
);

router.get(
  '/active',
  asyncHandler(async (req, res) => {
    const result = await resumeService.getActiveResume(req.user!.uid);
    sendSuccess(res, result, 'Active resume fetched');
  }),
);

export default router;
