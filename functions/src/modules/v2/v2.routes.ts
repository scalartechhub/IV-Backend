/**
 * V2 API router — mounts all architecture-aligned REST endpoints.
 * Auth: Firebase ID token via Authorization: Bearer <token>
 *
 * Practice / Interviews support the new dashboard UI:
 *   GET  /v2/practice/catalog
 *   POST /v2/interviews/start  (templateId | companyId | quickStart | full config)
 */

import { Router } from 'express';
import verifyToken from '../../middleware/auth.middleware';
import interviewRoutes from './interview.routes';
import jobDescriptionAnalysisRoutes from './job-description-analysis.routes';
import resumeRoutes from './resume.routes';
import onboardingRoutes from './onboarding.routes';
import codingRoutes from './coding.routes';
import learningRoadmapRoutes from './learning-roadmap.routes';
import profileRoutes from './profile.routes';
import achievementsRoutes from './achievements.routes';
import practiceRoutes from './practice.routes';
import reportsRoutes from './reports.routes';
import inviteRoutes from './invite.routes';
import interviewInvitesRoutes from './interview-invites.routes';

const router = Router();

// ── Public routes (no auth required / individual route auth) ─────────────────
// interview-invites: GET /:token and POST /:token/start are public (candidate-facing).
// The admin POST / endpoint inside the router applies verifyToken per-route.
router.use('/interview-invites', interviewInvitesRoutes);
router.use('/invites', inviteRoutes);

// ── Authenticated routes ──────────────────────────────────────────────────────
router.use(verifyToken);

router.use('/interviews', interviewRoutes);
router.use('/jobdescriptionanalysis', jobDescriptionAnalysisRoutes);
router.use('/practice', practiceRoutes);
router.use('/reports', reportsRoutes);
router.use('/resumes', resumeRoutes);
router.use('/onboarding', onboardingRoutes);
router.use('/coding', codingRoutes);
router.use('/learning-roadmap', learningRoadmapRoutes);
router.use('/profile', profileRoutes);
router.use('/achievements', achievementsRoutes);

export default router;
