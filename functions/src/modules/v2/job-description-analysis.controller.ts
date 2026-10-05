import { Request, Response, NextFunction } from 'express';
import { createJobDescriptionAnalysis } from './job-description-analysis.service';
import { logger } from '../../shared/logger';
import { AppError } from '../../shared/utils';

export const jobDescriptionAnalysisController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jdText } = req.body;

    if (!jdText || typeof jdText !== 'string') {
      throw new AppError(400, 'jdText is required and must be a string.');
    }

    logger.info('[jobDescriptionAnalysis] Starting JD analysis', { textLength: jdText.length });

    const jobDescription = await createJobDescriptionAnalysis(jdText);

    logger.info('[jobDescriptionAnalysis] Successfully created JD analysis', { jdId: jobDescription.id });

    res.status(201).json(jobDescription);
  } catch (error) {
    next(error);
  }
};
