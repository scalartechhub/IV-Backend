/**
 * V2 live interview WebSocket bridge.
 *
 * Browser <-> this server <-> Gemini Live (server holds GEMINI_API_KEY, browser never sees it).
 * Persists conversation turns to Firestore mid-call so page refresh can resume timer + context.
 * On reconnect the AI re-asks the last pending question or generates the next one.
 *
 * Turn-taking is client-controlled (automatic VAD disabled): the browser sends activityStart /
 * activityEnd so long answers are not cut off mid-pause. User captions for the UI come from
 * browser speech recognition; Gemini inputTranscription is not forwarded to the client.
 */

import { URL } from 'url';
import type { IncomingMessage, Server } from 'http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { LiveServerMessage, Session } from '@google/genai';
import { auth } from '../../config/firebase';
import { logger } from '../../shared/logger';
import { isCloudRuntime } from '../../shared/runtime';
import { ensureAdmin } from '../../utils/callable-auth';
import { interviewRef } from '../../utils/firestore-refs';
import type {
  InterviewConversationMessage,
  InterviewConversationRole,
  InterviewDoc,
  InterviewStatus,
} from '../../interfaces/interview.interface';
import {
  buildLiveConnectConfig,
  DEFAULT_LIVE_MODEL,
  getClient,
} from '../../library/gemini-client';
import {
  appendAssistantTurn,
  appendCandidateTurn,
  awaitPersistQueue,
  computeRemainingSeconds,
  ensureInterviewLiveStarted,
  resolveResumeMode,
  syncInterviewTimer,
} from './v2-live-interview.persistence';
import {
  buildResumeKickoffText,
  buildResumeSystemInstruction,
} from './v2-live-interview.prompt';

const V2_LIVE_WS_PATH = '/ws/v2/interview';

const NON_LIVE_STATUSES = new Set<InterviewStatus>(['completed', 'abandoned', 'expired']);

type V2LiveClientMessage =
  | { type: 'audio'; data: string; mimeType?: string }
  | { type: 'activityStart' }
  | { type: 'activityEnd' }
  | { type: 'userTurnFinal'; text: string }
  | { type: 'end' };

const sendJson = (socket: WebSocket, payload: Record<string, unknown>): void => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
};

const parseClientMessage = (raw: RawData): V2LiveClientMessage | null => {
  try {
    const parsed = JSON.parse(raw.toString()) as V2LiveClientMessage;
    if (!parsed?.type) return null;
    return parsed;
  } catch {
    return null;
  }
};

const requestUrl = (req: IncomingMessage): URL =>
  new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);

const verifyTokenFromRequest = async (req: IncomingMessage): Promise<string> => {
  const token = requestUrl(req).searchParams.get('token')?.trim();
  if (!token) {
    throw new Error('Missing authentication token');
  }
  const decoded = await auth.verifyIdToken(token);
  return decoded.uid;
};

const getInterviewIdFromRequest = (req: IncomingMessage): string => {
  const interviewId = requestUrl(req).searchParams.get('interviewId')?.trim();
  if (!interviewId) {
    throw new Error('Missing interviewId');
  }
  return interviewId;
};

const toClientConversation = (
  conversation: InterviewConversationMessage[],
): Array<{ id: string; role: 'ai' | 'user'; text: string }> =>
  conversation.map((entry) => ({
    id: entry.id,
    role: entry.role === 'assistant' ? 'ai' : 'user',
    text: entry.text,
  }));

export const setupV2LiveInterviewWebSocket = (server: Server): void => {
  if (isCloudRuntime()) {
    logger.warn(
      '[v2-live-interview] WebSocket server skipped on Cloud Functions runtime - use Render/local Node server',
    );
    return;
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (requestUrl(req).pathname !== V2_LIVE_WS_PATH) {
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', async (clientSocket, req) => {
    let geminiSession: Session | null = null;
    let closed = false;
    let firstAiSignalReceived = false;
    let kickoffRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let timerTickId: ReturnType<typeof setInterval> | null = null;
    /** True between client activityStart and activityEnd — hold AI audio so it cannot talk over the user. */
    let userTurnOpen = false;
    let latestInterview: InterviewDoc | null = null;
    let persistQueue: Promise<void> = Promise.resolve();

    const clearKickoffRetry = (): void => {
      if (kickoffRetryTimer) {
        clearTimeout(kickoffRetryTimer);
        kickoffRetryTimer = null;
      }
    };

    const clearTimerTick = (): void => {
      if (timerTickId != null) {
        clearInterval(timerTickId);
        timerTickId = null;
      }
    };

    const enqueuePersist = (task: () => Promise<void>): void => {
      persistQueue = persistQueue
        .catch(() => undefined)
        .then(task)
        .catch((error) => {
          logger.error('[v2-live-interview] persist failed', error);
        });
    };

    const closeAll = (reason?: string): void => {
      if (closed) return;
      closed = true;
      clearKickoffRetry();
      clearTimerTick();
      userTurnOpen = false;
      try {
        geminiSession?.close();
      } catch {
        // already closed
      }
      geminiSession = null;
      sendJson(clientSocket, reason ? { type: 'close', reason } : { type: 'close' });
      try {
        clientSocket.close();
      } catch {
        // already closed
      }
    };

    let interviewId = '';

    try {
      const uid = await verifyTokenFromRequest(req);
      interviewId = getInterviewIdFromRequest(req);

      const db = ensureAdmin();
      const snap = await interviewRef(db, interviewId).get();
      if (!snap.exists) {
        sendJson(clientSocket, { type: 'error', message: 'Interview not found.' });
        clientSocket.close();
        return;
      }
      const loaded = snap.data() as InterviewDoc;
      if (loaded.userId !== uid) {
        sendJson(clientSocket, {
          type: 'error',
          message: 'Interview does not belong to the authenticated user.',
        });
        clientSocket.close();
        return;
      }
      if (NON_LIVE_STATUSES.has(loaded.status)) {
        sendJson(clientSocket, { type: 'error', message: 'Interview is no longer active.' });
        clientSocket.close();
        return;
      }

      const started = await ensureInterviewLiveStarted(interviewId);
      let interview = started.interview;
      interview = {
        ...interview,
        remainingSeconds: computeRemainingSeconds(interview),
      };
      latestInterview = interview;

      let broadcastTimer = (): number => 0;
      let persistAssistantText = (_aiText: string): void => undefined;
      let persistCandidateText = (_answer: string): void => undefined;

      broadcastTimer = (): number => {
        if (!latestInterview) return 0;
        const remainingSeconds = computeRemainingSeconds(latestInterview);
        const liveElapsedSec = Math.max(
          0,
          (latestInterview.config.durationMinutes ?? 30) * 60 - remainingSeconds,
        );
        latestInterview = { ...latestInterview, remainingSeconds, liveElapsedSec };
        sendJson(clientSocket, {
          type: 'timer_tick',
          remainingSeconds,
          durationMinutes: latestInterview.config.durationMinutes,
          liveElapsedSec,
        });
        enqueuePersist(async () => {
          const timer = await syncInterviewTimer(interviewId);
          if (latestInterview) {
            latestInterview = {
              ...latestInterview,
              remainingSeconds: timer.remainingSeconds,
              liveElapsedSec: timer.liveElapsedSec,
            };
          }
        });
        return remainingSeconds;
      };

      persistAssistantText = (aiText: string): void => {
        enqueuePersist(async () => {
          const result = await appendAssistantTurn(interviewId, aiText);
          latestInterview = {
            ...(latestInterview ?? interview),
            conversation: result.conversation,
            lastSpeaker: result.lastSpeaker,
            remainingSeconds: result.remainingSeconds,
            liveElapsedSec: result.liveElapsedSec,
          };
          sendJson(clientSocket, {
            type: 'conversation_updated',
            conversation: toClientConversation(result.conversation),
            lastSpeaker: result.lastSpeaker,
            remainingSeconds: result.remainingSeconds,
          });
        });
      };

      persistCandidateText = (answer: string): void => {
        enqueuePersist(async () => {
          const result = await appendCandidateTurn(interviewId, answer);
          latestInterview = {
            ...(latestInterview ?? interview),
            conversation: result.conversation,
            lastSpeaker: result.lastSpeaker,
            remainingSeconds: result.remainingSeconds,
            liveElapsedSec: result.liveElapsedSec,
          };
          sendJson(clientSocket, {
            type: 'conversation_updated',
            conversation: toClientConversation(result.conversation),
            lastSpeaker: result.lastSpeaker,
            remainingSeconds: result.remainingSeconds,
          });
        });
      };

      const resumeMode = resolveResumeMode(interview);
      const isResume = resumeMode !== 'fresh';
      const conversation = interview.conversation ?? [];

      const baseInstructions =
        interview.aiSession?.systemInstructions ||
        `You are an expert interviewer conducting a ${interview.mode} interview for a ${interview.config.targetRole} role. Keep questions concise, probe depth, and be encouraging but rigorous. Conduct this entire interview in English only, and always reply in English, even if the candidate's speech sounds unusual due to accent. When transcribing or repeating back anything the candidate said, always write it in English using the Latin alphabet only — never output Hindi, Marathi, or any other non-Latin script.`;

      const systemInstructions = buildResumeSystemInstruction(
        baseInstructions,
        interview,
        resumeMode,
      );
      const model = interview.aiSession?.modelVersion || DEFAULT_LIVE_MODEL;

      const sessionPayload = {
        conversation: toClientConversation(conversation),
        lastSpeaker: (interview.lastSpeaker ?? null) as InterviewConversationRole | null,
        remainingSeconds: interview.remainingSeconds ?? computeRemainingSeconds(interview),
        liveElapsedSec: interview.liveElapsedSec,
        durationMinutes: interview.config.durationMinutes,
        resumeMode,
      };

      sendJson(clientSocket, {
        type: isResume ? 'interview_resumed' : 'interview_started',
        ...sessionPayload,
      });

      timerTickId = setInterval(() => {
        const remaining = broadcastTimer();
        if (remaining <= 0) {
          sendJson(clientSocket, { type: 'time_expired' });
        }
      }, 15_000);
      broadcastTimer();

      let aiTranscriptBuffer = '';

      const handleGeminiMessage = (message: LiveServerMessage): void => {
        const serverContent = message.serverContent;
        if (!serverContent) return;

        if (serverContent.interrupted) {
          aiTranscriptBuffer = '';
          sendJson(clientSocket, { type: 'interrupted' });
          return;
        }

        if (serverContent.outputTranscription?.text) {
          if (!userTurnOpen) {
            firstAiSignalReceived = true;
            clearKickoffRetry();
            aiTranscriptBuffer += serverContent.outputTranscription.text;
            const text = aiTranscriptBuffer.trim();
            if (text) {
              sendJson(clientSocket, { type: 'transcript', role: 'ai', text, final: false });
            }
          } else {
            aiTranscriptBuffer = '';
          }
        }

        const parts = serverContent.modelTurn?.parts ?? [];
        for (const part of parts) {
          const data = part.inlineData?.data;
          if (!data) continue;
          if (userTurnOpen) {
            continue;
          }
          firstAiSignalReceived = true;
          clearKickoffRetry();
          sendJson(clientSocket, {
            type: 'audio',
            data,
            mimeType: part.inlineData?.mimeType ?? 'audio/pcm;rate=24000',
          });
        }

        if (serverContent.turnComplete) {
          if (userTurnOpen) {
            aiTranscriptBuffer = '';
            return;
          }
          let aiText = aiTranscriptBuffer.trim();
          // Fallback only when audio transcription produced no text.
          if (!aiText) {
            aiText = parts
              .map((part) => part.text?.trim() ?? '')
              .filter(Boolean)
              .join(' ')
              .trim();
          }
          if (aiText) {
            sendJson(clientSocket, { type: 'transcript', role: 'ai', text: aiText, final: true });
            persistAssistantText(aiText);
          }
          aiTranscriptBuffer = '';
          sendJson(clientSocket, { type: 'turnComplete' });
        }
      };

      let kickoffAttempts = 0;
      const MAX_KICKOFF_ATTEMPTS = 3;

      const sendKickoff = (): void => {
        if (!geminiSession || firstAiSignalReceived) return;
        kickoffAttempts += 1;
        try {
          const lastAssistantQuestion = [...(interview.conversation ?? [])]
            .reverse()
            .find((entry) => entry.role === 'assistant')?.text;
          const kickoffText = buildResumeKickoffText(resumeMode, lastAssistantQuestion);
          if (!kickoffText) return;

          geminiSession.sendClientContent({
            turns: [
              {
                role: 'user',
                parts: [{ text: kickoffText }],
              },
            ],
            turnComplete: true,
          });
          logger.info(
            `[v2-live-interview] kickoff sent interviewId=${interviewId} attempt=${kickoffAttempts} mode=${resumeMode}`,
          );
        } catch (error) {
          logger.warn(`[v2-live-interview] kickoff failed interviewId=${interviewId}`, error);
        }

        clearKickoffRetry();
        if (kickoffAttempts >= MAX_KICKOFF_ATTEMPTS) return;
        kickoffRetryTimer = setTimeout(() => {
          kickoffRetryTimer = null;
          if (!firstAiSignalReceived && geminiSession) {
            logger.warn(
              `[v2-live-interview] no opening response yet, retrying kickoff interviewId=${interviewId}`,
            );
            sendKickoff();
          }
        }, 5000);
      };

      geminiSession = await getClient().live.connect({
        model,
        config: buildLiveConnectConfig(systemInstructions),
        callbacks: {
          onopen: () => {
            logger.info(`[v2-live-interview] Gemini session open interviewId=${interviewId}`);
            sendJson(clientSocket, { type: 'open' });
          },
          onmessage: handleGeminiMessage,
          onerror: (event) => {
            const message =
              event instanceof ErrorEvent && event.error instanceof Error
                ? event.error.message
                : 'Live interview connection error.';
            logger.error('[v2-live-interview] Gemini error', message);
            sendJson(clientSocket, { type: 'error', message });
          },
          onclose: () => {
            logger.info(`[v2-live-interview] Gemini session closed interviewId=${interviewId}`);
            closeAll('gemini_closed');
          },
        },
      });

      if (isResume && interview.conversation?.length) {
        try {
          await geminiSession.sendClientContent({
            turns: interview.conversation.map((message) => ({
              role: message.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: message.text }],
            })),
            turnComplete: false,
          });
        } catch (error) {
          logger.warn(
            `[v2-live-interview] conversation replay failed interviewId=${interviewId}`,
            error,
          );
        }
      }

      sendKickoff();

      clientSocket.on('message', (raw) => {
        const message = parseClientMessage(raw);
        if (!message || !geminiSession) return;

        if (message.type === 'userTurnFinal' && message.text?.trim()) {
          persistCandidateText(message.text.trim());
          return;
        }

        if (message.type === 'activityStart') {
          userTurnOpen = true;
          aiTranscriptBuffer = '';
          try {
            geminiSession.sendRealtimeInput({ activityStart: {} });
          } catch (error) {
            logger.warn(`[v2-live-interview] activityStart failed interviewId=${interviewId}`, error);
          }
          return;
        }

        if (message.type === 'activityEnd') {
          userTurnOpen = false;
          try {
            geminiSession.sendRealtimeInput({ activityEnd: {} });
          } catch (error) {
            logger.warn(`[v2-live-interview] activityEnd failed interviewId=${interviewId}`, error);
          }
          return;
        }

        if (message.type === 'audio' && message.data) {
          if (userTurnOpen) {
            geminiSession.sendRealtimeInput({
              audio: { data: message.data, mimeType: message.mimeType ?? 'audio/pcm;rate=16000' },
            });
          }
          return;
        }

        if (message.type === 'end') {
          closeAll('client_ended');
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start live session';
      logger.error('[v2-live-interview] connection failed', error);
      sendJson(clientSocket, { type: 'error', message });
      clientSocket.close();
      return;
    }

    clientSocket.on('close', () => {
      void awaitPersistQueue(persistQueue)
        .then(() => (interviewId ? syncInterviewTimer(interviewId) : undefined))
        .catch(() => undefined)
        .finally(() => closeAll());
    });
    clientSocket.on('error', (error) => {
      logger.error(`[v2-live-interview] client socket error interviewId=${interviewId}`, error);
      closeAll();
    });
  });

  logger.info(`[v2-live-interview] WebSocket server ready at ${V2_LIVE_WS_PATH}`);
};
