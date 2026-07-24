/**
 * V2 API router — mounts all architecture-aligned REST endpoints.
 * Auth: Firebase ID token via Authorization: Bearer <token>
 */

import { Router } from 'express';
import verifyToken from '../../middleware/auth.middleware';
import interviewRoutes from './interview.routes';
import resumeRoutes from './resume.routes';
import codingRoutes from './coding.routes';
import roadmapRoutes from './roadmap.routes';
import profileRoutes from './profile.routes';
import achievementsRoutes from './achievements.routes';

const router = Router();

router.use(verifyToken);

router.use('/interviews', interviewRoutes);
router.use('/resumes', resumeRoutes);
router.use('/coding', codingRoutes);
router.use('/roadmap', roadmapRoutes);
router.use('/profile', profileRoutes);
router.use('/achievements', achievementsRoutes);

export default router;
