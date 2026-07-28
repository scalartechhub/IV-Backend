/**
 * Mid-call Firestore persistence for v2 live interviews — conversation, timer, resume state.
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import type {
  InterviewConversationMessage,
  InterviewConversationRole,
  InterviewDoc,
} from '../../interfaces/interview.interface';
import { AppError } from '../../shared/utils';
import { logger } from '../../shared/logger';
import { ensureAdmin } from '../../utils/callable-auth';
import { interviewRef } from '../../utils/firestore-refs';

export type V2LiveResumeMode = 'fresh' | 'await_candidate' | 'generate_next';

const MAX_CONVERSATION_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 4000;

const clampMessage = (text: string): string =>
  text.trim().slice(0, MAX_MESSAGE_CHARS);

const timestampMs = (value?: Timestamp | null): number | null => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  return null;
};

const durationSecondsFor = (interview: Pick<InterviewDoc, 'config'>): number => {
  if (typeof interview.config?.durationMinutes === 'number' && interview.config.durationMinutes > 0) {
    return Math.floor(interview.config.durationMinutes * 60);
  }
  return 30 * 60;
};

export const computeRemainingSeconds = (
  interview: Pick<InterviewDoc, 'startedAt' | 'config' | 'remainingSeconds'>,
  nowMs = Date.now(),
): number => {
  const durationSeconds = durationSecondsFor(interview);

  const startedMs = timestampMs(interview.startedAt ?? null);
  if (startedMs != null) {
    const elapsed = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
    return Math.max(0, durationSeconds - elapsed);
  }

  if (typeof interview.remainingSeconds === 'number' && interview.remainingSeconds >= 0) {
    return Math.floor(interview.remainingSeconds);
  }

  return durationSeconds;
};

export const computeLiveElapsedSec = (
  interview: Pick<InterviewDoc, 'startedAt' | 'config' | 'remainingSeconds' | 'liveElapsedSec'>,
  nowMs = Date.now(),
): number => {
  if (typeof interview.liveElapsedSec === 'number' && interview.liveElapsedSec >= 0) {
    return Math.floor(interview.liveElapsedSec);
  }
  const durationSeconds = durationSecondsFor(interview);
  return Math.max(0, durationSeconds - computeRemainingSeconds(interview, nowMs));
};

export const resolveResumeMode = (
  interview: Pick<InterviewDoc, 'conversation' | 'lastSpeaker'>,
): V2LiveResumeMode => {
  const conversation = interview.conversation ?? [];
  if (!conversation.length) return 'fresh';
  if (interview.lastSpeaker === 'candidate') return 'generate_next';
  if (interview.lastSpeaker === 'assistant') return 'await_candidate';

  const last = conversation[conversation.length - 1];
  if (last?.role === 'candidate') return 'generate_next';
  if (last?.role === 'assistant') return 'await_candidate';
  return 'fresh';
};

export const formatConversationTranscript = (
  conversation: InterviewConversationMessage[] | undefined,
): string => {
  if (!conversation?.length) {
    return 'No conversation was captured during this session.';
  }
  return conversation
    .map((entry) => {
      const speaker = entry.role === 'assistant' ? 'Interviewer' : 'Candidate';
      return `${speaker}: ${entry.text}`;
    })
    .join('\n');
};

const assertConversationFitsDocument = (conversation: InterviewConversationMessage[]): void => {
  if (conversation.length > MAX_CONVERSATION_MESSAGES) {
    throw new AppError(
      409,
      'This interview has reached its transcript storage limit. Please finish the interview.',
    );
  }
};

const buildTimerPatch = (
  interview: InterviewDoc,
  now: Timestamp,
): { remainingSeconds: number; liveElapsedSec: number } => {
  const remainingSeconds = computeRemainingSeconds(
    {
      startedAt: interview.startedAt ?? now,
      config: interview.config,
      remainingSeconds: interview.remainingSeconds,
    },
    now.toMillis(),
  );
  const liveElapsedSec = Math.max(0, durationSecondsFor(interview) - remainingSeconds);
  return { remainingSeconds, liveElapsedSec };
};

/** Persist timer snapshot to Firestore (called on WS connect + periodic ticks). */
export const syncInterviewTimer = async (
  interviewId: string,
): Promise<{ remainingSeconds: number; liveElapsedSec: number }> => {
  const db = ensureAdmin();
  const ref = interviewRef(db, interviewId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, 'Interview not found.');

    const interview = snap.data() as InterviewDoc;
    if (interview.status === 'completed') {
      throw new AppError(400, 'This interview is already completed.');
    }

    const now = Timestamp.now();
    const timer = buildTimerPatch(interview, now);

    tx.update(ref, {
      ...timer,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return timer;
  });
};

/** Marks interview in_progress and sets timer fields. Always syncs timer to Firestore. */
export const ensureInterviewLiveStarted = async (
  interviewId: string,
): Promise<{ interview: InterviewDoc; created: boolean }> => {
  const db = ensureAdmin();
  const ref = interviewRef(db, interviewId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, 'Interview not found.');

    const interview = snap.data() as InterviewDoc;
    if (interview.status === 'completed') {
      throw new AppError(400, 'This interview is already completed.');
    }
    if (interview.status === 'abandoned' || interview.status === 'expired') {
      throw new AppError(400, 'This interview is no longer active.');
    }

    const now = Timestamp.now();
    const startedAt = interview.startedAt ?? now;
    const timer = buildTimerPatch({ ...interview, startedAt }, now);

    const patch: Partial<InterviewDoc> = {
      status: 'in_progress',
      startedAt,
      remainingSeconds: timer.remainingSeconds,
      liveElapsedSec: timer.liveElapsedSec,
      conversation: interview.conversation ?? [],
    };

    tx.update(ref, {
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const created = !interview.startedAt;
    return {
      interview: { ...interview, ...patch, updatedAt: now },
      created,
    };
  });
};

export const appendAssistantTurn = async (
  interviewId: string,
  questionText: string,
): Promise<{
  conversation: InterviewConversationMessage[];
  lastSpeaker: InterviewConversationRole;
  remainingSeconds: number;
  liveElapsedSec: number;
  created: boolean;
}> => {
  const messageText = clampMessage(questionText);
  if (!messageText) {
    throw new AppError(400, 'AI question text is empty.');
  }

  const db = ensureAdmin();
  const ref = interviewRef(db, interviewId);
  const messageId = `m-${randomUUID()}-a`;

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, 'Interview not found.');

    const interview = snap.data() as InterviewDoc;
    if (interview.status === 'completed') {
      throw new AppError(400, 'This interview is already completed.');
    }

    const now = Timestamp.now();
    const timer = buildTimerPatch(interview, now);
    const conversation = [...(interview.conversation ?? [])];
    const last = conversation[conversation.length - 1];

    if (last?.role === 'assistant' && last.text === messageText) {
      tx.update(ref, {
        lastSpeaker: 'assistant',
        remainingSeconds: timer.remainingSeconds,
        liveElapsedSec: timer.liveElapsedSec,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        conversation,
        lastSpeaker: 'assistant' as const,
        remainingSeconds: timer.remainingSeconds,
        liveElapsedSec: timer.liveElapsedSec,
        created: false,
      };
    }

    let nextConversation: InterviewConversationMessage[];
    const created = true;

    if (last?.role === 'assistant') {
      nextConversation = [
        ...conversation.slice(0, -1),
        { ...last, text: messageText, createdAt: now },
      ];
    } else {
      const message: InterviewConversationMessage = {
        id: messageId,
        role: 'assistant',
        text: messageText,
        createdAt: now,
      };
      nextConversation = [...conversation, message];
    }

    assertConversationFitsDocument(nextConversation);

    const patch: Partial<InterviewDoc> = {
      status: 'in_progress',
      startedAt: interview.startedAt ?? now,
      conversation: nextConversation,
      lastSpeaker: 'assistant',
      remainingSeconds: timer.remainingSeconds,
      liveElapsedSec: timer.liveElapsedSec,
    };

    tx.update(ref, {
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      conversation: nextConversation,
      lastSpeaker: 'assistant' as const,
      remainingSeconds: timer.remainingSeconds,
      liveElapsedSec: timer.liveElapsedSec,
      created,
    };
  });

  logger.info(
    `[v2-live-interview] assistant turn persisted interviewId=${interviewId} created=${result.created} messages=${result.conversation.length}`,
  );
  return result;
};

export const appendCandidateTurn = async (
  interviewId: string,
  answerText: string,
): Promise<{
  conversation: InterviewConversationMessage[];
  lastSpeaker: InterviewConversationRole;
  remainingSeconds: number;
  liveElapsedSec: number;
  created: boolean;
}> => {
  const messageText = clampMessage(answerText);
  if (!messageText) {
    throw new AppError(400, 'Candidate answer text is empty.');
  }

  const db = ensureAdmin();
  const ref = interviewRef(db, interviewId);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, 'Interview not found.');

    const interview = snap.data() as InterviewDoc;
    if (interview.status === 'completed') {
      throw new AppError(400, 'This interview is already completed.');
    }

    const now = Timestamp.now();
    const timer = buildTimerPatch(interview, now);
    const conversation = [...(interview.conversation ?? [])];
    const last = conversation[conversation.length - 1];

    if (last?.role === 'candidate' && last.text === messageText) {
      tx.update(ref, {
        lastSpeaker: 'candidate',
        remainingSeconds: timer.remainingSeconds,
        liveElapsedSec: timer.liveElapsedSec,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        conversation,
        lastSpeaker: 'candidate' as const,
        remainingSeconds: timer.remainingSeconds,
        liveElapsedSec: timer.liveElapsedSec,
        created: false,
      };
    }

    if (last?.role === 'candidate') {
      const nextConversation = [
        ...conversation.slice(0, -1),
        { ...last, text: messageText, createdAt: now },
      ];
      assertConversationFitsDocument(nextConversation);
      tx.update(ref, {
        conversation: nextConversation,
        lastSpeaker: 'candidate',
        remainingSeconds: timer.remainingSeconds,
        liveElapsedSec: timer.liveElapsedSec,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        conversation: nextConversation,
        lastSpeaker: 'candidate' as const,
        remainingSeconds: timer.remainingSeconds,
        liveElapsedSec: timer.liveElapsedSec,
        created: true,
      };
    }

    if (last?.role !== 'assistant') {
      throw new AppError(400, 'No active interviewer question to answer.');
    }

    const message: InterviewConversationMessage = {
      id: `m-${randomUUID()}-c`,
      role: 'candidate',
      text: messageText,
      createdAt: now,
    };

    const nextConversation = [...conversation, message];
    assertConversationFitsDocument(nextConversation);

    tx.update(ref, {
      conversation: nextConversation,
      lastSpeaker: 'candidate',
      remainingSeconds: timer.remainingSeconds,
      liveElapsedSec: timer.liveElapsedSec,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      conversation: nextConversation,
      lastSpeaker: 'candidate' as const,
      remainingSeconds: timer.remainingSeconds,
      liveElapsedSec: timer.liveElapsedSec,
      created: true,
    };
  });

  logger.info(
    `[v2-live-interview] candidate turn persisted interviewId=${interviewId} created=${result.created} messages=${result.conversation.length}`,
  );
  return result;
};

/** Wait for queued live-session writes before disconnect (best-effort). */
export const awaitPersistQueue = (queue: Promise<void>): Promise<void> =>
  queue.catch(() => undefined);
