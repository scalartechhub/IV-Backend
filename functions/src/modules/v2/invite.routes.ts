/**
 * Invite Candidates API Routes.
 * Endpoints for sending, listing, resending, and revoking candidate interview invitations.
 *
 * POST   /v2/invites/send            — Send invitation(s) to candidate email(s)
 * GET    /v2/invites/list/:linkId     — List invitations for a specific interview link
 * POST   /v2/invites/resend/:inviteId — Resend a pending/sent invitation
 * POST   /v2/invites/revoke/:inviteId — Revoke/cancel a pending invitation
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async.middleware';
import { validate } from '../../middleware/validation.middleware';
import verifyToken from '../../middleware/auth.middleware';
import { sendSuccess, sendCreated, sendError } from '../../shared/responses';
import { sendCandidateInviteEmail } from '../../services/email.service';
import { db } from '../../config/firebase';
import { logger } from '../../shared/logger';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

const router = Router();

// ─── Collection Reference ──────────────────────────────────────────────────────

const INVITES_COLLECTION = 'candidateInvites';
const INTERVIEW_LINKS_COLLECTION = 'InterviewLinks';
const JOB_DESCRIPTION_COLLECTION = 'jobDescription';

// ─── Frontend URL ──────────────────────────────────────────────────────────────

function getFrontendUrl(): string {
  const configured = process.env.IV_FRONTEND_URL?.trim();
  if (configured && !configured.includes('localhost')) {
    const clean = configured.replace(/\/+$/, '');
    if (clean.includes('app.interviewup.ai') && !clean.includes('www.')) {
      return clean.replace('app.interviewup.ai', 'www.app.interviewup.ai');
    }
    return clean;
  }
  return 'https://www.app.interviewup.ai';
}

// ─── Schemas ───────────────────────────────────────────────────────────────────

const candidateSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().optional(),
});

const sendInvitesBodySchema = z.object({
  interviewLinkId: z.string().min(1, 'interviewLinkId is required'),
  candidates: z.array(candidateSchema).min(1, 'At least one candidate is required').max(50, 'Maximum 50 candidates per batch'),
  validityDays: z.number().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
});

const linkIdParamSchema = z.object({
  linkId: z.string().min(1),
});

const inviteIdParamSchema = z.object({
  inviteId: z.string().min(1),
});

const checkStatusQuerySchema = z.object({
  email: z.string().email('Invalid email address'),
  jdId: z.string().min(1, 'jdId is required'),
});

// ─── GET /status/:inviteId — Public: Check candidate invitation status ─────────

router.get(
  '/status/:inviteId',
  validate(inviteIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { inviteId } = req.params as unknown as z.infer<typeof inviteIdParamSchema>;
    const inviteRef = db.collection(INVITES_COLLECTION).doc(inviteId);
    const inviteDoc = await inviteRef.get();

    if (!inviteDoc.exists) {
      sendError(res, 'Invitation not found', 404);
      return;
    }

    const data = inviteDoc.data()!;

    // Track 'OPENED' if currently in sent/delivered state
    if (['SENT', 'DELIVERED'].includes(data.status)) {
      void inviteRef.update({
        status: 'OPENED',
        openedAt: FieldValue.serverTimestamp(),
      }).catch(() => {});
    }

    sendSuccess(res, {
      inviteId: data.id || inviteDoc.id,
      email: data.email,
      name: data.name || null,
      status: data.status,
      revokedAt: data.revokedAt?.toDate?.() || null,
      expiresAt: data.expiresAt?.toDate?.() || null,
      score: typeof data.score === 'number' ? data.score : null,
      jobTitle: data.jobTitle || null,
      companyName: data.companyName || null,
      jdId: data.jdId || null,
      interviewLinkId: data.interviewLinkId || null,
    }, 'Invite status retrieved');
  }),
);

// ─── GET /check-email — Public: Check if email has revoked/active invite for JD ─

router.get(
  '/check-email',
  validate(checkStatusQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { email, jdId } = req.query as unknown as z.infer<typeof checkStatusQuerySchema>;

    const invitesSnap = await db.collection(INVITES_COLLECTION)
      .where('jdId', '==', jdId)
      .where('email', '==', email.toLowerCase().trim())
      .get();

    if (invitesSnap.empty) {
      sendSuccess(res, { isRevoked: false, status: null, invite: null });
      return;
    }

    const invites = invitesSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
    const isRevoked = invites.some(i => i.status === 'REVOKED');
    const completedInvite = invites.find(i => i.status === 'COMPLETED');
    const isCompleted = Boolean(completedInvite);
    const activeOrLatest = invites.find(i => i.status === 'REVOKED') || completedInvite || invites[0];

    sendSuccess(res, {
      isRevoked,
      isCompleted,
      score: typeof completedInvite?.score === 'number' ? completedInvite.score : null,
      status: isRevoked ? 'REVOKED' : (isCompleted ? 'COMPLETED' : activeOrLatest.status),
      inviteId: activeOrLatest.id,
    }, 'Invite check completed');
  }),
);

// ─── POST /send — Admin: Send Invitations ──────────────────────────────────────

router.post(
  '/send',
  verifyToken,
  validate(sendInvitesBodySchema),
  asyncHandler(async (req, res) => {
    const { interviewLinkId, candidates } = req.body as z.infer<typeof sendInvitesBodySchema>;
    const adminUid = req.user!.uid;

    // 1. Fetch interview link
    const linkDoc = await db.collection(INTERVIEW_LINKS_COLLECTION).doc(interviewLinkId).get();
    if (!linkDoc.exists) {
      sendError(res, 'Interview link not found', 404);
      return;
    }
    const linkData = linkDoc.data()!;

    // Check link is active
    if (linkData.status !== 'ACTIVE') {
      sendError(res, `Cannot send invites for an interview link with status "${linkData.status}". Link must be ACTIVE.`, 400);
      return;
    }

    // Check link has not expired
    if (linkData.expiresAt) {
      const linkExpiresDate = linkData.expiresAt.toDate ? linkData.expiresAt.toDate() : new Date(linkData.expiresAt);
      if (linkExpiresDate.getTime() < Date.now()) {
        sendError(res, 'Cannot send invites for an expired interview link. Please update or renew the interview link expiration first.', 400);
        return;
      }
    }

    // 2. Fetch job description for email content
    const jdDoc = await db.collection(JOB_DESCRIPTION_COLLECTION).doc(linkData.jdId).get();
    const jdData = jdDoc.exists ? jdDoc.data()! : {};

    const companyName = jdData.companyName || 'InterviewUp';
    const jobTitle = jdData.title || linkData.name || 'Interview Assessment';
    const interviewType = linkData.interviewType || 'AI';
    const durationMinutes = linkData.durationMinutes || 30;
    const frontendUrl = getFrontendUrl();

    // 3. Determine dynamic expiry for candidates
    const { validityDays, expiresAt: customExpiresAt } = req.body as z.infer<typeof sendInvitesBodySchema>;
    let calculatedExpiresAt: Date | null = null;

    if (typeof validityDays === 'number' && validityDays > 0) {
      calculatedExpiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);
    } else if (customExpiresAt) {
      calculatedExpiresAt = new Date(customExpiresAt);
    } else if (linkData.expiresAt) {
      calculatedExpiresAt = linkData.expiresAt.toDate ? linkData.expiresAt.toDate() : new Date(linkData.expiresAt);
    }

    let expiresAtText: string | undefined;
    if (calculatedExpiresAt && !isNaN(calculatedExpiresAt.getTime())) {
      expiresAtText = calculatedExpiresAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // 4. Send emails sequentially with a polite delay between sends to prevent Gmail rate-burst spam flagging
    const results: Array<{ email: string; status: 'sent' | 'failed'; inviteId?: string; error?: string }> = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const inviteRef = db.collection(INVITES_COLLECTION).doc();
      const inviteUrl = `${frontendUrl}/jd-view/${linkData.jdId}?inviteId=${inviteRef.id}`;

      try {
        // Check for existing non-revoked invite to same email for same link
        const existingSnap = await db.collection(INVITES_COLLECTION)
          .where('interviewLinkId', '==', interviewLinkId)
          .where('email', '==', candidate.email)
          .where('status', 'in', ['SENT', 'DELIVERED', 'OPENED', 'STARTED'])
          .limit(1)
          .get();

        if (!existingSnap.empty) {
          results.push({ email: candidate.email, status: 'failed', error: 'Candidate already has an active invitation for this link' });
          continue;
        }

        // Send email
        const messageId = await sendCandidateInviteEmail({
          candidateEmail: candidate.email,
          candidateName: candidate.name,
          companyName,
          jobTitle,
          interviewLinkUrl: inviteUrl,
          interviewType,
          durationMinutes,
          expiresAt: expiresAtText,
        });

        // Store invite record in Firestore
        const inviteDoc = {
          id: inviteRef.id,
          interviewLinkId,
          jdId: linkData.jdId,
          email: candidate.email,
          name: candidate.name || null,
          inviteUrl,
          status: 'SENT',
          sentAt: FieldValue.serverTimestamp(),
          sentBy: adminUid,
          expiresAt: calculatedExpiresAt && !isNaN(calculatedExpiresAt.getTime()) ? Timestamp.fromDate(calculatedExpiresAt) : null,
          emailMessageId: messageId || null,
          deliveryStatus: 'pending',
          failureReason: null,
          jobApplicationId: null,
          interviewSessionId: null,
          score: null,
          // Denormalized for fast table rendering
          jobTitle,
          companyName,
          interviewLinkName: linkData.name || null,
        };

        await inviteRef.set(inviteDoc);
        results.push({ email: candidate.email, status: 'sent', inviteId: inviteRef.id });

        // Throttle 1 second between multiple candidates to avoid bulk burst spam penalties
        if (i < candidates.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error: any) {
        logger.error(`[InviteRoutes] Failed to send invite to ${candidate.email}`, { error: error.message });
        results.push({ email: candidate.email, status: 'failed', error: error.message });
      }
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;

    sendCreated(res, { sent, failed, results }, `${sent} invitation(s) sent successfully`);
  }),
);

// ─── GET /list & GET /list/:linkId — List Invites ────────────────────────────

router.get(
  ['/list', '/list/:linkId'],
  verifyToken,
  asyncHandler(async (req, res) => {
    const rawParam = req.params?.['linkId'];
    const rawQuery = req.query?.['linkId'];
    const rawLinkId = typeof rawParam === 'string' ? rawParam : (typeof rawQuery === 'string' ? rawQuery : undefined);
    const linkId = rawLinkId && rawLinkId !== 'all' ? rawLinkId : undefined;
    const status = typeof req.query?.['status'] === 'string' ? req.query['status'] : undefined;

    let queryRef: FirebaseFirestore.Query = db.collection(INVITES_COLLECTION);

    if (linkId) {
      queryRef = queryRef.where('interviewLinkId', '==', linkId);
    }
    if (status) {
      queryRef = queryRef.where('status', '==', status);
    }

    const snap = await queryRef.limit(200).get();
    const invites = snap.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        sentAt: data.sentAt?.toDate?.() || null,
        openedAt: data.openedAt?.toDate?.() || null,
        startedAt: data.startedAt?.toDate?.() || null,
        completedAt: data.completedAt?.toDate?.() || null,
        revokedAt: data.revokedAt?.toDate?.() || null,
        expiresAt: data.expiresAt?.toDate?.() || null,
      };
    });

    sendSuccess(res, invites, `Fetched ${invites.length} invite(s)`);
  }),
);

// ─── POST /resend/:inviteId — Resend Invitation ────────────────────────────────

router.post(
  '/resend/:inviteId',
  verifyToken,
  validate(inviteIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { inviteId } = req.params as unknown as z.infer<typeof inviteIdParamSchema>;

    const inviteRef = db.collection(INVITES_COLLECTION).doc(inviteId);
    const inviteDoc = await inviteRef.get();

    if (!inviteDoc.exists) {
      sendError(res, 'Invitation not found', 404);
      return;
    }

    const inviteData = inviteDoc.data()!;

    if (['COMPLETED', 'REVOKED'].includes(inviteData.status)) {
      sendError(res, `Cannot resend an invitation with status "${inviteData.status}"`, 400);
      return;
    }

    // Re-fetch link/JD for updated content
    const linkDoc = await db.collection(INTERVIEW_LINKS_COLLECTION).doc(inviteData.interviewLinkId).get();
    const linkData = linkDoc.exists ? linkDoc.data()! : {};
    const jdDoc = await db.collection(JOB_DESCRIPTION_COLLECTION).doc(inviteData.jdId).get();
    const jdData = jdDoc.exists ? jdDoc.data()! : {};

    const rawInviteUrl = inviteData.inviteUrl || `${getFrontendUrl()}/jd-view/${inviteData.jdId}?inviteId=${inviteData.id}`;
    const cleanInviteUrl =
      rawInviteUrl.includes('app.interviewup.ai') && !rawInviteUrl.includes('www.')
        ? rawInviteUrl.replace('app.interviewup.ai', 'www.app.interviewup.ai')
        : rawInviteUrl;

    const messageId = await sendCandidateInviteEmail({
      candidateEmail: inviteData.email,
      candidateName: inviteData.name,
      companyName: jdData.companyName || inviteData.companyName || 'InterviewUp',
      jobTitle: jdData.title || inviteData.jobTitle || 'Interview Assessment',
      interviewLinkUrl: cleanInviteUrl,
      interviewType: linkData.interviewType || 'AI',
      durationMinutes: linkData.durationMinutes || 30,
    });

    await inviteRef.update({
      status: 'SENT',
      sentAt: FieldValue.serverTimestamp(),
      emailMessageId: messageId || inviteData.emailMessageId || null,
      deliveryStatus: 'pending',
    });

    sendSuccess(res, { inviteId, email: inviteData.email, resent: true }, 'Invitation resent successfully');
  }),
);

// ─── POST /revoke/:inviteId — Revoke Invitation ────────────────────────────────

router.post(
  '/revoke/:inviteId',
  verifyToken,
  validate(inviteIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { inviteId } = req.params as unknown as z.infer<typeof inviteIdParamSchema>;

    const inviteRef = db.collection(INVITES_COLLECTION).doc(inviteId);
    const inviteDoc = await inviteRef.get();

    if (!inviteDoc.exists) {
      sendError(res, 'Invitation not found', 404);
      return;
    }

    const inviteData = inviteDoc.data()!;

    if (inviteData.status === 'REVOKED') {
      sendError(res, 'Invitation is already revoked', 400);
      return;
    }

    if (inviteData.status === 'COMPLETED') {
      sendError(res, 'Cannot revoke a completed interview invitation', 400);
      return;
    }

    await inviteRef.update({
      status: 'REVOKED',
      revokedAt: FieldValue.serverTimestamp(),
    });

    sendSuccess(res, { inviteId, status: 'REVOKED' }, 'Invitation revoked successfully');
  }),
);

// ─── DELETE /:inviteId — Delete Invitation Record ───────────────────────────

router.delete(
  '/:inviteId',
  verifyToken,
  validate(inviteIdParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { inviteId } = req.params as unknown as z.infer<typeof inviteIdParamSchema>;

    const inviteRef = db.collection(INVITES_COLLECTION).doc(inviteId);
    const inviteDoc = await inviteRef.get();

    if (!inviteDoc.exists) {
      sendError(res, 'Invitation not found', 404);
      return;
    }

    await inviteRef.delete();
    sendSuccess(res, { inviteId, deleted: true }, 'Invitation deleted successfully');
  }),
);

export default router;

