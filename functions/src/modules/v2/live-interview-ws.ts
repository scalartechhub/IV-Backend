/**
 * V2 live interview WebSocket bridge.
 *
 * Browser <-> this server <-> Gemini Live (server holds GEMINI_API_KEY, browser never sees it).
 * Persists conversation turns to Firestore mid-call so page refresh can resume timer + context.
 * On reconnect the AI re-asks the last pending question or generates the next one.
 *
 * Turn-taking is client-controlled (automatic VAD disabled): the browser sends activityStart /
 * activityEnd so long answers are not cut off mid-pause. User captions for the UI come from
 * browser speech recognition plus Gemini inputTranscription (Latin/English only — Indic-script
 * misdetections are dropped so Telugu/Hindi never replaces English on screen).
 */

import { URL } from 'url';
import type { IncomingMessage, Server } from 'http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { LiveServerMessage, Session } from '@google/genai';
import { auth } from '../../config/firebase';
import { logger } from '../../shared/logger';
import { appConfig } from '../../config/app.config';
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
  getDefaultLiveModel,
  getClient,
} from '../../library/gemini-client';
import { buildInterviewSystemInstructions } from '../../services/interview-prompt';
import {
  buildCodeSnippetTool,
  PRESENT_CODE_SNIPPET_TOOL_NAME,
  requiredSnippetQuestionCount,
  type CodeSnippetPayload,
} from '../../library/code-snippet';
import {
  appendAssistantTurn,
  appendCandidateTurn,
  awaitPersistQueue,
  computeLiveElapsedSec,
  computeRemainingSeconds,
  ensureInterviewLiveStarted,
  resolveResumeMode,
  syncInterviewTimer,
} from './v2-live-interview.persistence';
import {
  buildResumeKickoffText,
  buildResumeSystemInstruction,
} from './v2-live-interview.prompt';
import { compressConversation, getReplayTurns } from '../live-interview/context-manager';
import {
  containsLiveTranscriptArtifacts,
  isLatinEnglishCaption,
  resolveAssistantTranscript,
  sanitizeLiveTranscript,
} from '../../shared/utils/live-transcript';

const V2_LIVE_WS_PATHS = new Set([
  '/ws/v2/interview',
  '/v2/live-interview/ws',
  '/api/ws/v2/interview',
  '/api/v2/live-interview/ws',
]);

const NON_LIVE_STATUSES = new Set<InterviewStatus>(['completed', 'abandoned', 'expired']);

const ALLOWED_ORIGIN_PATTERNS = [
  'app.interviewup.ai',
  'ws.interviewup.ai',
  'interviewup.ai',
  'firebaseapp.com',
  'web.app',
  'localhost',
  '127.0.0.1',
];

const isAllowedOrigin = (origin?: string): boolean => {
  if (!origin) return true; // Allow non-browser clients (e.g. CLI tools / health checks)
  if (!appConfig.isProduction) return true;
  const corsConfig = appConfig.corsOrigin;
  if (corsConfig && corsConfig !== '*') {
    const allowedList = corsConfig.split(',').map((o) => o.trim().toLowerCase());
    if (allowedList.includes(origin.toLowerCase())) return true;
  }
  const lower = origin.toLowerCase();
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => lower.includes(pattern));
};

interface ExtWebSocket extends WebSocket {
  isAlive?: boolean;
}

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
): Array<{
  id: string;
  role: 'ai' | 'user';
  text: string;
  codeSnippet?: { code: string; language: string };
}> =>
  conversation.map((entry) => ({
    id: entry.id,
    role: entry.role === 'assistant' ? 'ai' : 'user',
    text: entry.text,
    ...(entry.codeSnippet ? { codeSnippet: entry.codeSnippet } : {}),
  }));

export const setupV2LiveInterviewWebSocket = (server: Server): void => {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pathname = requestUrl(req).pathname;
    if (!V2_LIVE_WS_PATHS.has(pathname)) {
      return;
    }

    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin)) {
      logger.warn('[v2-live-interview] Rejected WebSocket upgrade: forbidden origin', { origin });
      socket.write(
        'HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nForbidden Origin',
      );
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', async (clientSocket, req) => {
    const extSocket = clientSocket as ExtWebSocket;
    extSocket.isAlive = true;

    clientSocket.on('pong', () => {
      extSocket.isAlive = true;
    });

    let pingTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (extSocket.isAlive === false) {
        logger.warn('[v2-live-interview] Terminating dead socket connection');
        clientSocket.terminate();
        return;
      }
      extSocket.isAlive = false;
      try {
        clientSocket.ping();
      } catch {
        // ignore write error
      }
    }, 30_000);

    let geminiSession: Session | null = null;
    let closed = false;
    let firstAiSignalReceived = false;
    let kickoffRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let timerTickId: ReturnType<typeof setInterval> | null = null;
    /** True between client activityStart and activityEnd — hold AI audio so it cannot talk over the user. */
    let userTurnOpen = false;
    /** Caption text from the browser STT — forwarded to Gemini if audio alone is insufficient. */
    let pendingCandidateText = '';
    let receivedUserAudioThisTurn = false;
    let userAudioChunksCount = 0;
    let userAudioBytesTotal = 0;
    let userAudioSampleBase64 = '';
    /** Set after activityEnd until the model produces the next assistant turn. */
    let awaitingAiResponse = false;
    let latestInterview: InterviewDoc | null = null;
    let persistQueue: Promise<void> = Promise.resolve();
    /** Snippet captured via present_code_snippet, attached to the assistant turn once its transcript arrives. */
    let pendingCodeSnippet: CodeSnippetPayload | null = null;
    /** Deterministic count of code-snippet questions asked so far, synced from Firestore writes. */
    let codeSnippetQuestionsAsked = 0;
    /** Ensures the mid-call snippet reminder nudge is only sent once per connection. */
    let snippetReminderSent = false;
    /** Ensures the 3-minute remaining wrap-up prompt is only sent once per connection. */
    let timeWrapReminderSent = false;

    const clearKickoffRetry = (): void => {
      if (kickoffRetryTimer) {
        clearTimeout(kickoffRetryTimer);
        kickoffRetryTimer = null;
      }
    };

    let aiResponseWatchdogTimer: NodeJS.Timeout | null = null;

    const clearAiResponseWatchdog = (): void => {
      if (aiResponseWatchdogTimer != null) {
        clearTimeout(aiResponseWatchdogTimer);
        aiResponseWatchdogTimer = null;
      }
    };

    const clearTimerTick = (): void => {
      if (timerTickId != null) {
        clearInterval(timerTickId);
        timerTickId = null;
      }
    };

    const clearPingTimer = (): void => {
      if (pingTimer != null) {
        clearInterval(pingTimer);
        pingTimer = null;
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
      clearAiResponseWatchdog();
      clearTimerTick();
      clearPingTimer();
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
      try {
        interviewId = getInterviewIdFromRequest(req);
      } catch {
        logger.warn('[v2-live-interview] Connection rejected: missing interviewId');
        sendJson(clientSocket, { type: 'error', message: 'Missing interviewId' });
        clientSocket.close(4000, 'Missing interviewId');
        return;
      }

      logger.info('[v2-live-interview] WebSocket connection received', {
        interviewId,
        origin: req.headers.origin,
      });

      let uid = '';
      try {
        uid = await verifyTokenFromRequest(req);
      } catch (authErr) {
        const message = authErr instanceof Error ? authErr.message : 'Invalid authentication token';
        logger.warn('[v2-live-interview] Token verification failed', { interviewId, error: message });
        sendJson(clientSocket, { type: 'error', message });
        clientSocket.close(4001, 'Unauthorized');
        return;
      }

      const db = ensureAdmin();
      const snap = await interviewRef(db, interviewId).get();
      if (!snap.exists) {
        logger.warn('[v2-live-interview] Interview not found', { interviewId, uid });
        sendJson(clientSocket, { type: 'error', message: 'Interview not found.' });
        clientSocket.close(4004, 'Interview not found');
        return;
      }
      const loaded = snap.data() as InterviewDoc;
      if (loaded.userId !== uid) {
        logger.warn('[v2-live-interview] Ownership authorization failed', {
          interviewId,
          authenticatedUid: uid,
          ownerUid: loaded.userId,
        });
        sendJson(clientSocket, {
          type: 'error',
          message: 'Interview does not belong to the authenticated user.',
        });
        clientSocket.close(4003, 'Forbidden');
        return;
      }
      if (NON_LIVE_STATUSES.has(loaded.status)) {
        logger.warn('[v2-live-interview] Interview no longer active', {
          interviewId,
          status: loaded.status,
        });
        sendJson(clientSocket, { type: 'error', message: 'Interview is no longer active.' });
        clientSocket.close(4000, 'Interview is no longer active');
        return;
      }

      logger.info('[v2-live-interview] Connection authorized & starting session', {
        interviewId,
        uid,
      });

      const started = await ensureInterviewLiveStarted(interviewId);
      let interview = started.interview;

      let candidateName = interview.candidateName?.trim() || '';
      if (!candidateName || /^(candidate|user|anonymous|guest|null|undefined)$/i.test(candidateName)) {
        try {
          const userSnap = await db.collection('users').doc(uid).get();
          const userData = userSnap.data();
          candidateName =
            userData?.displayName?.trim() ||
            userData?.name?.trim() ||
            userData?.profile?.fullName?.trim() ||
            '';
        } catch {
          // ignore lookup error
        }
      }

      const remainingSeconds = computeRemainingSeconds(interview);
      const liveElapsedSec = computeLiveElapsedSec(interview);
      interview = {
        ...interview,
        ...(candidateName ? { candidateName } : {}),
        remainingSeconds,
        liveElapsedSec,
      };
      latestInterview = interview;
      codeSnippetQuestionsAsked = interview.codeSnippetQuestionsAsked ?? 0;

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
        const snippetForThisTurn = pendingCodeSnippet ?? undefined;
        pendingCodeSnippet = null;
        enqueuePersist(async () => {
          const result = await appendAssistantTurn(interviewId, aiText, snippetForThisTurn);
          codeSnippetQuestionsAsked = result.codeSnippetQuestionsAsked;
          latestInterview = {
            ...(latestInterview ?? interview),
            conversation: result.conversation,
            lastSpeaker: result.lastSpeaker,
            remainingSeconds: result.remainingSeconds,
            liveElapsedSec: result.liveElapsedSec,
            codeSnippetQuestionsAsked: result.codeSnippetQuestionsAsked,
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
      const isAlreadyStarted =
        Boolean(interview.startedAt) ||
        (interview.liveElapsedSec ?? 0) > 0 ||
        Boolean(interview.conversation?.length);
      const isResume = resumeMode !== 'fresh' || isAlreadyStarted;
      const conversation = interview.conversation ?? [];

      const baseInstructions =
        interview.aiSession?.systemInstructions ||
        buildInterviewSystemInstructions(interview.mode, interview.config);

      const systemInstructions = buildResumeSystemInstruction(
        baseInstructions,
        interview,
        resumeMode,
      );
      const model = interview.aiSession?.modelVersion || getDefaultLiveModel();

      const sessionPayload = {
        conversation: toClientConversation(conversation),
        lastSpeaker: (interview.lastSpeaker ?? null) as InterviewConversationRole | null,
        remainingSeconds: computeRemainingSeconds(interview),
        liveElapsedSec: computeLiveElapsedSec(interview),
        durationMinutes: interview.config.durationMinutes,
        resumeMode,
      };

      sendJson(clientSocket, {
        type: isResume ? 'interview_resumed' : 'interview_started',
        ...sessionPayload,
      });

      const startTimerTicker = (): void => {
        if (timerTickId) return;
        timerTickId = setInterval(() => {
          const remaining = broadcastTimer();
          if (remaining <= 0) {
            sendJson(clientSocket, { type: 'time_expired' });
            return;
          }

          // One-shot safety-net reminder past the session's midpoint if the snippet-question
          // minimum (see CODE SNIPPET QUESTIONS in interview-prompt.ts) has not yet been met.
          // Sent as context only (turnComplete: false) so it never interrupts the live turn-taking.
          if (!snippetReminderSent && geminiSession) {
            const durationMinutes = latestInterview?.config.durationMinutes ?? interview.config.durationMinutes;
            const totalSec = Math.max(1, durationMinutes * 60);
            const required = requiredSnippetQuestionCount(durationMinutes);
            const pastMidpoint = remaining <= totalSec * 0.45;
            if (pastMidpoint && codeSnippetQuestionsAsked < required) {
              snippetReminderSent = true;
              const isJdInterview = Boolean(
                latestInterview?.config.jobDescriptionText?.trim() ??
                  interview.config.jobDescriptionText?.trim(),
              );
              const reminderText = isJdInterview
                ? `(Interviewer reminder — not spoken to candidate) So far you have asked ` +
                  `${codeSnippetQuestionsAsked} code-snippet question(s) out of the ${required} ` +
                  'required for this JD-based technical interview. Use present_code_snippet to show ' +
                  'code on screen — NEVER ask the candidate to write or type code (no code editor). ' +
                  'Ask them to explain, debug, or reason about the snippet verbally.'
                : `(Interviewer reminder — not spoken to candidate) So far you have asked ` +
                  `${codeSnippetQuestionsAsked} code-snippet question(s) out of the ${required} ` +
                  'required for technical/IT interviews (see CODE SNIPPET QUESTIONS rule). ' +
                  'If this is a technology/software/IT-role interview, plan to ask one soon via ' +
                  'the present_code_snippet tool before you run out of time. Ignore this note ' +
                  'entirely if this is not a technical/IT interview.';
              try {
                geminiSession.sendClientContent({
                  turns: [
                    {
                      role: 'user',
                      parts: [
                        {
                          text: reminderText,
                        },
                      ],
                    },
                  ],
                  turnComplete: false,
                });
              } catch (error) {
                logger.warn(`[v2-live-interview] snippet reminder failed interviewId=${interviewId}`, error);
              }
            }
          }

          // When remaining time is under 3 minutes (180s), send one-shot wrap-up reminder to Gemini
          if (remaining > 0 && remaining <= 180 && !timeWrapReminderSent && geminiSession) {
            timeWrapReminderSent = true;
            try {
              geminiSession.sendClientContent({
                turns: [
                  {
                    role: 'user',
                    parts: [
                      {
                        text:
                          '(Interviewer time wrap mandate — do NOT read this prompt aloud) Less than 3 minutes remain. ' +
                          'Do NOT ask any new technical questions. In your very next turn, say: ' +
                          '"I am done from my end due to time limitation. Do you have any questions for me? If not, then we can stop the interview." ' +
                          'If the candidate has no questions or says no, thank them warmly and conclude the interview.',
                      },
                    ],
                  },
                ],
                turnComplete: false,
              });
            } catch (error) {
              logger.warn(`[v2-live-interview] time wrap reminder failed interviewId=${interviewId}`, error);
            }
          }
        }, 5_000);
        broadcastTimer();
      };

      if (isResume || isAlreadyStarted) {
        startTimerTicker();
      }

      let aiTranscriptBuffer = '';
      /** Accumulated Gemini inputTranscription for the open candidate turn (live UI captions). */
      let userTranscriptBuffer = '';

      const handleToolCall = (functionCalls: NonNullable<LiveServerMessage['toolCall']>['functionCalls']): void => {
        if (!geminiSession || !functionCalls?.length) return;

        const functionResponses = functionCalls.map((call) => {
          if (call.name === PRESENT_CODE_SNIPPET_TOOL_NAME) {
            const args = (call.args ?? {}) as Record<string, unknown>;
            const code = typeof args.code === 'string' ? args.code.trim() : '';
            const language = typeof args.language === 'string' ? args.language.trim() : 'text';
            const questionText = typeof args.questionText === 'string' ? args.questionText.trim() : '';

            if (code) {
              pendingCodeSnippet = { code, language: language || 'text', questionText };
              sendJson(clientSocket, {
                type: 'code_snippet',
                code,
                language: language || 'text',
                questionText,
              });
              logger.info(`[v2-live-interview] code snippet tool call interviewId=${interviewId} language=${language}`);
            } else {
              logger.warn(`[v2-live-interview] present_code_snippet call missing code interviewId=${interviewId}`);
            }
          }

          return {
            id: call.id,
            name: call.name,
            response: { success: true },
          };
        });

        try {
          geminiSession.sendToolResponse({ functionResponses });
        } catch (error) {
          logger.warn(`[v2-live-interview] sendToolResponse failed interviewId=${interviewId}`, error);
        }
      };

      const handleGeminiMessage = (message: LiveServerMessage): void => {
        if (message.toolCall?.functionCalls?.length) {
          handleToolCall(message.toolCall.functionCalls);
        }

        const serverContent = message.serverContent;
        if (!serverContent) return;

        if (serverContent.interrupted) {
          aiTranscriptBuffer = '';
          userTranscriptBuffer = '';
          sendJson(clientSocket, { type: 'interrupted' });
          return;
        }

        // Live candidate captions from Gemini (complements browser Web Speech for long answers).
        // Drop Telugu/Hindi phonetic misdetections — only relay Latin English to the UI.
        const geminiInputText = serverContent.inputTranscription?.text;
        const geminiInterimText = serverContent.interimInputTranscription?.text;
        if (geminiInputText || geminiInterimText) {
          if (geminiInputText) {
            userTranscriptBuffer = [userTranscriptBuffer, geminiInputText].filter(Boolean).join(' ').trim();
          }
          const fullRaw = [userTranscriptBuffer, geminiInterimText].filter(Boolean).join(' ').trim();
          const text = sanitizeLiveTranscript(fullRaw);
          if (text && isLatinEnglishCaption(text)) {
            sendJson(clientSocket, {
              type: 'transcript',
              role: 'user',
              text,
              stableText: sanitizeLiveTranscript(userTranscriptBuffer),
              interimText: sanitizeLiveTranscript(geminiInterimText ?? ''),
              final: false,
            });
          }
        }

        const onFirstAiSignal = (): void => {
          if (firstAiSignalReceived) return;
          firstAiSignalReceived = true;
          clearKickoffRetry();
          if (!latestInterview?.startedAt) {
            enqueuePersist(async () => {
              const started = await ensureInterviewLiveStarted(interviewId, true);
              if (latestInterview) {
                latestInterview = {
                  ...latestInterview,
                  startedAt: started.interview.startedAt,
                  remainingSeconds: started.interview.remainingSeconds,
                  liveElapsedSec: started.interview.liveElapsedSec,
                };
              }
            });
          }
          startTimerTicker();
        };

        if (serverContent.outputTranscription?.text) {
          if (!userTurnOpen) {
            clearAiResponseWatchdog();
            onFirstAiSignal();
            aiTranscriptBuffer += serverContent.outputTranscription.text;
            const text = sanitizeLiveTranscript(aiTranscriptBuffer);
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
          clearAiResponseWatchdog();
          onFirstAiSignal();
          sendJson(clientSocket, {
            type: 'audio',
            data,
            mimeType: part.inlineData?.mimeType ?? 'audio/pcm;rate=24000',
          });
        }

        if (serverContent.turnComplete) {
          clearAiResponseWatchdog();
          if (userTurnOpen) {
            aiTranscriptBuffer = '';
            return;
          }
          let aiText = resolveAssistantTranscript({
            outputTranscription: aiTranscriptBuffer,
            modelTurnText: parts
              .map((part) => part.text?.trim() ?? '')
              .filter(Boolean)
              .join(' ')
              .trim(),
            snippetQuestionText: pendingCodeSnippet?.questionText,
          });
          if (containsLiveTranscriptArtifacts(aiTranscriptBuffer) && aiText) {
            logger.warn(
              `[v2-live-interview] stripped ctrl artifacts from AI transcript interviewId=${interviewId}`,
            );
          }
          if (aiText) {
            sendJson(clientSocket, { type: 'transcript', role: 'ai', text: aiText, final: true });
            persistAssistantText(aiText);
            awaitingAiResponse = false;
          } else if (awaitingAiResponse && geminiSession) {
            logger.warn(
              `[v2-live-interview] empty AI turn after candidate answer, nudging interviewId=${interviewId}`,
            );
            awaitingAiResponse = false;
            clearAiResponseWatchdog();
            try {
              geminiSession.sendClientContent({
                turns: [
                  {
                    role: 'user',
                    parts: [
                      {
                        text:
                          'The candidate has finished their answer. Acknowledge briefly and ask your next interview question now.',
                      },
                    ],
                  },
                ],
                turnComplete: true,
              });
              geminiSession.sendRealtimeInput({ activityEnd: {} });
            } catch (error) {
              logger.warn(
                `[v2-live-interview] next-question nudge failed interviewId=${interviewId}`,
                error,
              );
            }
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
          const kickoffText = buildResumeKickoffText(
            resumeMode,
            lastAssistantQuestion,
            latestInterview || interview,
          );
          if (!kickoffText) return;

          userTurnOpen = false;
          geminiSession.sendClientContent({
            turns: [
              {
                role: 'user',
                parts: [{ text: kickoffText }],
              },
            ],
            turnComplete: true,
          });
          try {
            geminiSession.sendRealtimeInput({ activityEnd: {} });
          } catch {
            // ignore
          }
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
              `[v2-live-interview] no opening response yet, retrying kickoff interviewId=${interviewId} attempt=${kickoffAttempts + 1}`,
            );
            sendKickoff();
          }
        }, 5000);
      };

      geminiSession = await getClient().live.connect({
        model,
        config: buildLiveConnectConfig(systemInstructions, [buildCodeSnippetTool()]),
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
          // Use rolling context: only replay recent turns to reduce context usage.
          // Older conversation is already compressed into the system instruction.
          const compressed = compressConversation(interview.conversation);
          const replayTurns = getReplayTurns(compressed);

          if (replayTurns.length > 0) {
            await geminiSession.sendClientContent({
              turns: replayTurns,
              turnComplete: false,
            });
          }
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
          pendingCandidateText = message.text.trim();
          logger.info(`[v2-live-interview] 🎙️ Client Answer Transcript (userTurnFinal) interviewId=${interviewId}: "${pendingCandidateText}"`);
          persistCandidateText(pendingCandidateText);
          return;
        }

        if (message.type === 'activityStart') {
          pendingCandidateText = '';
          receivedUserAudioThisTurn = false;
          userAudioChunksCount = 0;
          userAudioBytesTotal = 0;
          userAudioSampleBase64 = '';
          userTurnOpen = true;
          aiTranscriptBuffer = '';
          userTranscriptBuffer = '';
          try {
            geminiSession.sendRealtimeInput({ activityStart: {} });
          } catch (error) {
            logger.warn(`[v2-live-interview] activityStart failed interviewId=${interviewId}`, error);
          }
          return;
        }

        if (message.type === 'activityEnd') {
          userTurnOpen = false;
          // Capture Gemini audio transcription for comparison
          const geminiCaption = sanitizeLiveTranscript(userTranscriptBuffer);
          userTranscriptBuffer = '';

          let captionText = pendingCandidateText;
          pendingCandidateText = '';

          // If client-side Web Speech did not yield caption, use Gemini's audio transcription
          if (!captionText && geminiCaption && isLatinEnglishCaption(geminiCaption)) {
            captionText = geminiCaption;
            persistCandidateText(geminiCaption);
          }

          const durationSec = (userAudioBytesTotal / 32000).toFixed(2);
          logger.info(`[v2-live-interview] Turn comparison interviewId=${interviewId} client="${captionText}" gemini="${geminiCaption}" audioBytes=${userAudioBytesTotal} audioChunks=${userAudioChunksCount} durationSec=${durationSec}`);

          if (geminiCaption && isLatinEnglishCaption(geminiCaption)) {
            sendJson(clientSocket, {
              type: 'transcript',
              role: 'user',
              text: geminiCaption,
              final: true,
            });
          }

          awaitingAiResponse = true;
          try {
            geminiSession.sendRealtimeInput({ activityEnd: {} });
          } catch (error) {
            logger.warn(`[v2-live-interview] activityEnd failed interviewId=${interviewId}`, error);
          }
          if (captionText && !receivedUserAudioThisTurn) {
            const remainingSecs = broadcastTimer();
            const shouldWrap = remainingSecs > 0 && remainingSecs <= 180 && !timeWrapReminderSent;
            if (shouldWrap) {
              timeWrapReminderSent = true;
            }
            const textToSend = shouldWrap
              ? `${captionText}\n\n(Time is under 3 minutes — do not ask new questions. State: "I am done from my end due to time limitation. Do you have any questions for me? If not, then we can stop the interview.")`
              : captionText;
            try {
              geminiSession.sendClientContent({
                turns: [{ role: 'user', parts: [{ text: textToSend }] }],
                turnComplete: true,
              });
              geminiSession.sendRealtimeInput({ activityEnd: {} });
            } catch (error) {
              logger.warn(
                `[v2-live-interview] candidate caption forward failed interviewId=${interviewId}`,
                error,
              );
            }
          }

          clearAiResponseWatchdog();
          aiResponseWatchdogTimer = setTimeout(() => {
            aiResponseWatchdogTimer = null;
            if (awaitingAiResponse && geminiSession) {
              logger.warn(
                `[v2-live-interview] AI response latency watchdog fired (2800ms), nudging interviewId=${interviewId}`,
              );
              try {
                const remainingSecs = broadcastTimer();
                const isUnder3Min = remainingSecs > 0 && remainingSecs <= 180 && !timeWrapReminderSent;
                let nudgePrompt: string;
                if (isUnder3Min) {
                  timeWrapReminderSent = true;
                  nudgePrompt =
                    'Under 3 minutes remain. Wrap up now without asking any new questions: ' +
                    'say "I am done from my end due to time limitation. Do you have any questions for me? If not, then we can stop the interview."';
                } else {
                  nudgePrompt = captionText
                    ? `The candidate has submitted their answer: "${captionText}". Acknowledge briefly and ask your next interview question now without delay. Do NOT reveal or explain the answer.`
                    : 'The candidate has finished their answer. Acknowledge briefly and ask your next interview question now without delay. Do NOT reveal or explain the answer.';
                }
                geminiSession.sendClientContent({
                  turns: [
                    {
                      role: 'user',
                      parts: [
                        {
                          text: nudgePrompt,
                        },
                      ],
                    },
                  ],
                  turnComplete: true,
                });
                geminiSession.sendRealtimeInput({ activityEnd: {} });
              } catch (error) {
                logger.warn(
                  `[v2-live-interview] latency watchdog nudge failed interviewId=${interviewId}`,
                  error,
                );
              }
            }
          }, 2800);

          return;
        }

        if (message.type === 'audio' && message.data) {
          if (!userTurnOpen && !awaitingAiResponse) {
            userTurnOpen = true;
            receivedUserAudioThisTurn = false;
            userAudioChunksCount = 0;
            userAudioBytesTotal = 0;
            userAudioSampleBase64 = '';
            aiTranscriptBuffer = '';
            userTranscriptBuffer = '';
            try {
              geminiSession.sendRealtimeInput({ activityStart: {} });
            } catch (error) {
              logger.warn(`[v2-live-interview] auto-activityStart failed interviewId=${interviewId}`, error);
            }
          }
          if (userTurnOpen) {
            receivedUserAudioThisTurn = true;
            userAudioChunksCount++;
            const byteLen = Math.round((message.data.length * 3) / 4);
            userAudioBytesTotal += byteLen;
            if (!userAudioSampleBase64) {
              userAudioSampleBase64 = message.data.slice(0, 100);
            }
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

  logger.info(`[v2-live-interview] WebSocket server ready`);
};
