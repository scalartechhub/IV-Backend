/**
 * Interview Invites API — JD-based candidate invitation flow.
 *
 * POST   /v2/interview-invites           — (auth required) Admin creates invite token
 * GET    /v2/interview-invites/:token    — (public) Candidate reads invite details
 * POST   /v2/interview-invites/:token/start — (public) Candidate starts interview
 *
 * Token-based invites differ from candidateInvites (email tracking):
 *   candidateInvites = email delivery tracking (SENT/OPENED status)
 *   interviewInvites = secure token for starting the actual interview session
 */

import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { auth as firebaseAuth, db } from '../../config/firebase';
import { asyncHandler } from '../../middleware/async.middleware';
import { validate } from '../../middleware/validation.middleware';
import verifyToken from '../../middleware/auth.middleware';
import { sendSuccess, sendCreated, sendError } from '../../shared/responses';
import { logger } from '../../shared/logger';
import type { InterviewInviteDoc, JdSnapshot } from '../../interfaces/interview-invite.interface';
import { startInterview } from '../../services/interview.service';

const router = Router();

// ─── Collections ──────────────────────────────────────────────────────────────

const INVITES_COL = 'interviewInvites';
const JD_COL = 'jobDescription';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a URL-safe cryptographically secure random token. */
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Hash the token with SHA-256 for safe Firestore storage. */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Find an invite document by plain token (hashes it and queries by tokenHash). */
async function findInviteByToken(
  token: string,
): Promise<{ doc: FirebaseFirestore.DocumentSnapshot; data: InterviewInviteDoc } | null> {
  const tokenHash = hashToken(token.trim());
  const snap = await db
    .collection(INVITES_COL)
    .where('tokenHash', '==', tokenHash)
    .limit(1)
    .get();

  if (snap.empty) return null;
  return { doc: snap.docs[0], data: snap.docs[0].data() as InterviewInviteDoc };
}

/** Build the JD text string that is injected into Gemini system instructions. */
function buildJdText(snap: JdSnapshot): string {
  return [
    snap.title ? `Job Title: ${snap.title}` : '',
    snap.companyName ? `Company: ${snap.companyName}` : '',
    snap.jobSummary ? `Summary:\n${snap.jobSummary}` : '',
    snap.keyResponsibilities.length
      ? `Key Responsibilities:\n${snap.keyResponsibilities.join('\n')}`
      : '',
    snap.requiredQualifications.length
      ? `Required Qualifications:\n${snap.requiredQualifications.join('\n')}`
      : '',
    snap.requiredSkills.length
      ? `Required Skills:\n${snap.requiredSkills.join(', ')}`
      : '',
    snap.preferredSkills?.length
      ? `Preferred Skills:\n${snap.preferredSkills.join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Resolve the frontend URL from env — never hardcode domain. */
function getFrontendUrl(): string {
  const raw = process.env.IV_FRONTEND_URL?.trim();
  if (raw && !raw.includes('localhost')) {
    return raw.replace(/\/+$/, '');
  }
  return 'https://www.app.interviewup.ai';
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createInviteSchema = z.object({
  jdId: z.string().min(1, 'jdId is required'),
  candidateName: z.string().min(1, 'candidateName is required').max(120),
  candidateEmail: z.string().email('Invalid candidate email'),
  interviewType: z
    .enum(['conversational', 'behavioral', 'system_design', 'hr', 'coding'])
    .default('conversational'),
  durationMinutes: z.number().int().min(10).max(120).default(30),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  expiresInDays: z.number().int().min(1).max(30).optional(),
});

const tokenParamSchema = z.object({
  token: z.string().min(1),
});

const startInviteSchema = z.object({
  candidateName: z.string().min(1).max(120).optional(),
  candidateEmail: z.string().email().optional(),
});

// ─── POST /v2/interview-invites — Admin creates invite (requires auth) ─────────

router.post(
  '/',
  verifyToken,
  validate(createInviteSchema),
  asyncHandler(async (req, res) => {
    const adminUid = req.user!.uid;
    const {
      jdId,
      candidateName,
      candidateEmail,
      interviewType,
      durationMinutes,
      difficulty,
      expiresInDays,
    } = req.body as z.infer<typeof createInviteSchema>;

    // 1. Fetch and validate JD
    const jdDoc = await db.collection(JD_COL).doc(jdId).get();
    if (!jdDoc.exists) {
      sendError(res, 'Job description not found.', 404);
      return;
    }
    const jdData = jdDoc.data()!;

    // 2. Build JD snapshot (captured at invite creation — insulated from later edits)
    const jdSnapshot: JdSnapshot = {
      title: jdData.title || '',
      companyName: jdData.companyName || '',
      requiredSkills: Array.isArray(jdData.requiredSkills) ? jdData.requiredSkills : [],
      preferredSkills: Array.isArray(jdData.preferredSkills) ? jdData.preferredSkills : undefined,
      keyResponsibilities: Array.isArray(jdData.keyResponsibilities)
        ? jdData.keyResponsibilities
        : [],
      requiredQualifications: Array.isArray(jdData.requiredQualifications)
        ? jdData.requiredQualifications
        : [],
      jobSummary: jdData.jobSummary || undefined,
    };

    // 3. Generate secure token
    const token = generateToken();
    const tokenHash = hashToken(token);

    // 4. Compute expiry
    let expiresAt: Timestamp | undefined;
    if (expiresInDays) {
      const expDate = new Date();
      expDate.setDate(expDate.getDate() + expiresInDays);
      expiresAt = Timestamp.fromDate(expDate);
    }

    // 5. Create invite document in Firestore
    const inviteRef = db.collection(INVITES_COL).doc();
    const inviteDoc: Omit<InterviewInviteDoc, 'id'> & { id: string } = {
      id: inviteRef.id,
      tokenHash,
      jdId,
      jdSnapshot,
      candidateName,
      candidateEmail,
      interviewType,
      durationMinutes,
      difficulty,
      createdBy: adminUid,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp() as unknown as Timestamp,
      ...(expiresAt ? { expiresAt } : {}),
    };

    await inviteRef.set(inviteDoc);

    const inviteUrl = `${getFrontendUrl()}/invite/${token}`;

    logger.info('[interview-invites] Invite created', {
      inviteId: inviteRef.id,
      jdId,
      candidateEmail,
      adminUid,
    });

    sendCreated(
      res,
      {
        inviteId: inviteRef.id,
        token,
        inviteUrl,
        status: 'pending',
        interviewId: null,
      },
      'Interview invitation created successfully.',
    );
  }),
);

// ─── GET /v2/interview-invites/:token — Public: candidate reads invite ─────────

router.get(
  '/:token',
  validate(tokenParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { token } = req.params as z.infer<typeof tokenParamSchema>;

    const result = await findInviteByToken(token);
    if (!result) {
      sendError(res, 'Interview invitation not found.', 404);
      return;
    }

    const { data: invite } = result;

    // Check expiry
    if (invite.expiresAt) {
      const expiry = invite.expiresAt.toDate ? invite.expiresAt.toDate() : new Date(invite.expiresAt as unknown as string);
      if (new Date() > expiry) {
        sendError(res, 'This interview invitation has expired.', 410);
        return;
      }
    }

    let score: number | null = null;
    let results: Record<string, unknown> | null = null;
    let customToken: string | null = null;
    if (invite.status === 'completed' && invite.interviewId) {
      try {
        const interviewSnap = await db.collection('interviews').doc(invite.interviewId).get();
        if (interviewSnap.exists) {
          const ivData = interviewSnap.data();
          score = typeof ivData?.results?.overallScore === 'number' ? ivData.results.overallScore : null;
          results = ivData?.results ?? null;
        }
      } catch (e) {
        logger.warn('[interview-invites] Could not fetch completed interview results', e);
      }

      if (invite.candidateUid) {
        try {
          customToken = await firebaseAuth.createCustomToken(invite.candidateUid, {
            inviteId: invite.id,
            role: 'candidate',
          });
        } catch (tokenErr) {
          logger.warn('[interview-invites] Could not create custom token for completed invite', tokenErr);
        }
      }
    }

    // Return candidate-safe payload only — no tokenHash, no admin UID, no internal prompts
    sendSuccess(res, {
      inviteId: invite.id,
      candidateName: invite.candidateName,
      candidateEmail: invite.candidateEmail,
      jd: {
        id: invite.jdId,
        title: invite.jdSnapshot.title,
        companyName: invite.jdSnapshot.companyName,
        requiredSkills: invite.jdSnapshot.requiredSkills,
        preferredSkills: invite.jdSnapshot.preferredSkills ?? [],
      },
      interview: {
        type: invite.interviewType,
        durationMinutes: invite.durationMinutes,
        difficulty: invite.difficulty,
      },
      status: invite.status,
      interviewId: invite.interviewId ?? null,
      score,
      results,
      customToken,
    });
  }),
);

// ─── POST /v2/interview-invites/:token/start — Public: candidate starts interview

router.post(
  '/:token/start',
  validate(tokenParamSchema, 'params'),
  validate(startInviteSchema),
  asyncHandler(async (req, res) => {
    const { token } = req.params as z.infer<typeof tokenParamSchema>;
    const body = req.body as z.infer<typeof startInviteSchema>;

    const result = await findInviteByToken(token);
    if (!result) {
      sendError(res, 'Interview invitation not found.', 404);
      return;
    }

    const { doc: inviteDocRef, data: invite } = result;

    // 1. Validate expiry
    if (invite.expiresAt) {
      const expiry = invite.expiresAt.toDate ? invite.expiresAt.toDate() : new Date(invite.expiresAt as unknown as string);
      if (new Date() > expiry) {
        sendError(res, 'This interview invitation has expired.', 410);
        return;
      }
    }

    // 2. Validate status
    if (invite.status === 'cancelled') {
      sendError(res, 'This interview invitation has been cancelled.', 410);
      return;
    }
    if (invite.status === 'completed') {
      sendError(res, 'This interview has already been completed.', 409);
      return;
    }

    // 3. If already started and interview still active — return existing session (refresh-safe)
    if (invite.status === 'started' && invite.interviewId && invite.candidateUid) {
      const existingInterviewSnap = await db.collection('interviews').doc(invite.interviewId).get();
      if (existingInterviewSnap.exists) {
        const existingStatus = existingInterviewSnap.data()?.status;
        const terminalStatuses = new Set(['completed', 'abandoned', 'expired']);
        if (!terminalStatuses.has(existingStatus)) {
          // Return existing interview — generate a fresh custom token for the candidate
          try {
            const customToken = await firebaseAuth.createCustomToken(invite.candidateUid, {
              inviteId: invite.id,
              role: 'candidate',
            });
            sendSuccess(res, {
              interviewId: invite.interviewId,
              customToken,
              status: 'started',
              resumeExisting: true,
            });
            return;
          } catch (tokenErr) {
            logger.error('[interview-invites] Failed to create resume custom token', tokenErr);
            // Fall through to create fresh if token mint fails
          }
        }
      }
    }

    // 4. Get or create anonymous Firebase user for this candidate
    let candidateUid = invite.candidateUid;
    if (!candidateUid) {
      // Create a new anonymous-style user via Admin SDK
      // We use email as the identifier so repeated invites for same email reuse user
      const emailForUser = body.candidateEmail || invite.candidateEmail;
      try {
        const existingUser = await firebaseAuth.getUserByEmail(emailForUser);
        candidateUid = existingUser.uid;
      } catch {
        // User does not exist — create one
        const newUser = await firebaseAuth.createUser({
          email: emailForUser,
          displayName: body.candidateName || invite.candidateName,
          disabled: false,
        });
        candidateUid = newUser.uid;
      }
    }

    // 5. Build jobDescriptionText from stored snapshot (so JD edits don't affect in-progress interviews)
    const jobDescriptionText = buildJdText(invite.jdSnapshot);

    // 6. Concurrency-safe double check before creating interview session
    const freshInviteSnap = await inviteDocRef.ref.get();
    const freshData = freshInviteSnap.data() as InterviewInviteDoc;
    if (freshData?.status === 'completed') {
      sendError(res, 'This interview has already been completed.', 409);
      return;
    }
    if (freshData?.status === 'started' && freshData.interviewId && freshData.candidateUid) {
      const customToken = await firebaseAuth.createCustomToken(freshData.candidateUid, {
        inviteId: invite.id,
        role: 'candidate',
      });
      sendSuccess(res, {
        interviewId: freshData.interviewId,
        customToken,
        status: 'started',
        resumeExisting: true,
      });
      return;
    }

    // 7. Create interview using the EXISTING interview service
    const startResult = await startInterview(candidateUid, {
      mode: invite.interviewType as 'conversational' | 'behavioral' | 'system_design' | 'hr' | 'coding',
      topic: `${invite.jdSnapshot.title} at ${invite.jdSnapshot.companyName}`,
      company: invite.jdSnapshot.companyName,
      skills: invite.jdSnapshot.requiredSkills.slice(0, 8),
      technologies: invite.jdSnapshot.requiredSkills.slice(0, 8),
      difficulty: invite.difficulty,
      durationMinutes: invite.durationMinutes,
      jobDescriptionText,
      jdId: invite.jdId,
      inviteId: invite.id,
      focusAreas: {
        technical: true,
        coding: invite.interviewType === 'conversational' || invite.interviewType === 'coding',
        behavioral: invite.interviewType === 'behavioral',
        problemSolving: true,
        communication: true,
      },
    });

    // 8. Update invite document — status, attemptCount, interviewId, candidateUid, startedAt
    await inviteDocRef.ref.update({
      status: 'started',
      attemptCount: 1,
      startedAt: FieldValue.serverTimestamp(),
      interviewId: startResult.interviewId,
      candidateUid,
    });

    // 9. Mint Firebase custom token so candidate can authenticate with WS
    const customToken = await firebaseAuth.createCustomToken(candidateUid, {
      inviteId: invite.id,
      role: 'candidate',
    });

    logger.info('[interview-invites] Interview started from invite', {
      inviteId: invite.id,
      interviewId: startResult.interviewId,
      candidateUid,
    });

    sendCreated(res, {
      interviewId: startResult.interviewId,
      geminiSessionConfig: startResult.geminiSessionConfig,
      customToken,
      status: 'started',
      resumeExisting: false,
    });
  }),
);

export default router;
