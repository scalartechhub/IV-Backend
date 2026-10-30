import { Router } from 'express';
import { asyncHandler } from '../../middleware/async.middleware';
import { sendSuccess } from '../../shared/responses';
import { getAdminUserResume, listAdminUsers } from './admin-users.service';
import { listAdminInterviews } from './admin-interviews.service';

const router = Router();

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const pageSize = Number(req.query.pageSize ?? 10);
    const result = await listAdminUsers({
      actorUid: req.user!.uid,
      pageSize: Number.isFinite(pageSize) ? pageSize : 10,
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : null,
      sort: typeof req.query.sort === 'string' ? req.query.sort : 'recent',
      search: typeof req.query.search === 'string' ? req.query.search : '',
      plan: typeof req.query.plan === 'string' ? req.query.plan : 'ALL',
      onboarding: typeof req.query.onboarding === 'string' ? req.query.onboarding : 'ALL',
      interviewUse: typeof req.query.interviewUse === 'string' ? req.query.interviewUse : 'ALL',
      payment: typeof req.query.payment === 'string' ? req.query.payment : 'ALL',
    });
    sendSuccess(res, result, 'Users page loaded');
  }),
);

router.get(
  '/users/:uid/resume',
  asyncHandler(async (req, res) => {
    const result = await getAdminUserResume(req.user!.uid, String(req.params.uid || ''));
    sendSuccess(res, result, 'Resumes loaded');
  }),
);

router.get(
  '/interviews',
  asyncHandler(async (req, res) => {
    const pageSize = Number(req.query.pageSize ?? 10);
    const result = await listAdminInterviews({
      actorUid: req.user!.uid,
      pageSize: Number.isFinite(pageSize) ? pageSize : 10,
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : null,
      sort: typeof req.query.sort === 'string' ? req.query.sort : 'recent',
      search: typeof req.query.search === 'string' ? req.query.search : '',
      status: typeof req.query.status === 'string' ? req.query.status : 'ALL',
      origin: typeof req.query.origin === 'string' ? req.query.origin : 'ALL',
      userId: typeof req.query.userId === 'string' ? req.query.userId : '',
    });
    sendSuccess(res, result, 'Interviews page loaded');
  }),
);

export default router;
