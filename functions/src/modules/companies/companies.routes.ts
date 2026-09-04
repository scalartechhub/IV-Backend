import { Router } from 'express';
import { asyncHandler } from '../../middleware/async.middleware';
import { validate } from '../../middleware/validation.middleware';
import * as controller from './companies.controller';
import { nearbyQuerySchema } from './companies.validation';

const router = Router();

// Single endpoint: GET /v2/companies/nearby
router.get(
  '/nearby',
  validate(nearbyQuerySchema, 'query'),
  asyncHandler(controller.getNearby),
);

export default router;

