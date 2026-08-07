/**
 * V2 API router — mounts all architecture-aligned REST endpoints.
 * Auth: Firebase ID token via Authorization: Bearer <token>
 *
 * Practice / Reports / Interviews support the new dashboard UI:
 *   GET  /v2/practice/catalog
 *   GET  /v2/reports/summary
 *   POST /v2/interviews/start  (templateId | companyId | quickStart | full config)
 */

import { Router } from 'express';
import verifyToken from '../../middleware/auth.middleware';
import interviewRoutes from './interview.routes';
import resumeRoutes from './resume.routes';
import onboardingRoutes from './onboarding.routes';
import codingRoutes from './coding.routes';
import learningRoadmapRoutes from './learning-roadmap.routes';
import profileRoutes from './profile.routes';
import achievementsRoutes from './achievements.routes';
import practiceRoutes from './practice.routes';
import reportsRoutes from './reports.routes';

const router = Router();

router.use(verifyToken);

router.use('/interviews', interviewRoutes);
router.use('/practice', practiceRoutes);
router.use('/reports', reportsRoutes);
router.use('/resumes', resumeRoutes);
router.use('/onboarding', onboardingRoutes);
router.use('/coding', codingRoutes);
router.use('/learning-roadmap', learningRoadmapRoutes);
router.use('/profile', profileRoutes);
router.use('/achievements', achievementsRoutes);

export default router;
