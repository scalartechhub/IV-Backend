import { Router } from 'express';
import { asyncHandler } from '../../middleware/async.middleware';
import { sendSuccess } from '../../shared/responses';
import { getAdminUserResume, listAdminUsers } from './admin-users.service';
import { listAdminInterviews } from './admin-interviews.service';
import {
  buildWeeklyProgressReportData,
  findUserByEmail,
  renderWeeklyProgressEmailHtml,
  renderWeeklyProgressEmailText,
  sendWeeklyProgressEmailForUser,
  sendWeeklyProgressReportsToAllUsers,
} from '../../services/weekly-report-email.service';
import { AppError } from '../../shared/utils';

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

router.post(
  '/weekly-reports/send',
  asyncHandler(async (req, res) => {
    const { dryRun, limit, uid, email, force, recipientEmailOverride } = req.body || {};

    let targetUid = uid ? String(uid).trim() : undefined;
    if (!targetUid && email) {
      const user = await findUserByEmail(String(email));
      if (!user) {
        throw new AppError(404, `No user found with email: ${email}`);
      }
      targetUid = user.id;
    }

    if (targetUid) {
      if (dryRun) {
        const data = await buildWeeklyProgressReportData(targetUid);
        if (!data) {
          throw new AppError(404, 'User not found or has no email address.');
        }
        sendSuccess(res, { dryRun: true, reportData: data }, 'Weekly report preview generated');
        return;
      }

      const result = await sendWeeklyProgressEmailForUser(targetUid, {
        force: Boolean(force),
        recipientEmailOverride: typeof recipientEmailOverride === 'string' ? recipientEmailOverride : undefined,
      });
      sendSuccess(res, result, result.success ? 'Weekly progress email dispatched' : 'Weekly email skipped/failed');
      return;
    }

    const batchResult = await sendWeeklyProgressReportsToAllUsers({
      dryRun: Boolean(dryRun),
      limit: typeof limit === 'number' ? limit : undefined,
    });

    sendSuccess(
      res,
      batchResult,
      dryRun ? 'Dry-run weekly report simulation completed' : 'Weekly progress report batch completed',
    );
  }),
);

router.get(
  '/weekly-reports/preview/:target',
  asyncHandler(async (req, res) => {
    const target = String(req.params.target || '').trim();
    let targetUid = target;

    if (target.includes('@')) {
      const user = await findUserByEmail(target);
      if (!user) {
        throw new AppError(404, `No user found with email: ${target}`);
      }
      targetUid = user.id;
    }

    const data = await buildWeeklyProgressReportData(targetUid);
    if (!data) {
      throw new AppError(404, 'User not found or has no email address.');
    }

    const html = renderWeeklyProgressEmailHtml(data);
    const text = renderWeeklyProgressEmailText(data);

    if (req.query.format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
      return;
    }

    sendSuccess(res, { reportData: data, html, text }, 'Report preview rendered');
  }),
);

export default router;
