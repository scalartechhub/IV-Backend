/**
 * V2 resume Express routes.
 */

import { Router } from 'express';
import { asyncHandler } from '../../middleware/async.middleware';
import { requirePdfUpload } from '../../middleware/upload.middleware';
import { AppError } from '../../shared/utils';
import { sendCreated } from '../../shared/responses';
import * as resumeService from '../../services/resume.service';

const router = Router();

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
    });
    sendCreated(res, result, 'Resume analyzed successfully');
  }),
);

export default router;
