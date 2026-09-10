import { Router } from 'express';
import { body } from 'express-validator';
import { jobDescriptionAnalysisController } from './job-description-analysis.controller';
import { checkRequestValidation } from '../../middleware/request-validation.middleware';

const router = Router();

router.post(
  '/',
  [
    body('jdText')
      .isString()
      .withMessage('jdText must be a string')
      .notEmpty()
      .withMessage('jdText is required')
      .isLength({ min: 50 })
      .withMessage('jdText must be at least 50 characters long'),
  ],
  checkRequestValidation,
  jobDescriptionAnalysisController
);

export default router;
