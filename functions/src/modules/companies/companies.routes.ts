/**
 * Companies routes.
 * Mounts POST /nearby with rate limiting (30 requests/min).
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { companiesController } from './companies.controller';

const router = Router();

const nearbyRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.uid || req.ip || 'anonymous',
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many nearby organization requests. Please wait before trying again.',
    },
  },
});

router.post('/nearby', nearbyRateLimiter, companiesController.getNearbyOrganizations);

export default router;
