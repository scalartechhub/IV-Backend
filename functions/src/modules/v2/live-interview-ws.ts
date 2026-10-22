/**
 * V2 live interview WebSocket bridge.
 *
 * Browser <-> this server <-> Gemini Live (server holds GEMINI_API_KEY, browser never sees it).
 * Persists conversation turns to Firestore mid-call so page refresh can resume timer + context.
 * On reconnect the AI re-asks the last pending question or generates the next one.
 *
 * Turn-taking is client-controlled: the browser sends activityStart / activityEnd so long answers
 * are not cut off mid-pause. Candidate audio is NOT streamed to Gemini — each submitted answer is
 * sent as one text turn (browser caption, or a transcription of the buffered audio when the
 * caption is empty) so the interviewer replies exactly once, to the words the candidate saw.
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
  transcribeInterviewAudio,
} from '../../library/gemini-client';
import { buildInterviewSystemInstructions } from '../../prompts/interview/interview-system.prompt';
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
  reviseCandidateAnswer,
  computeLiveElapsedSec,
  computeRemainingSeconds,
  ensureInterviewLiveStarted,
  resolveResumeMode,
  syncInterviewTimer,
} from './v2-live-interview.persistence';
import {
  buildInteractiveFollowUpDirector,
  buildMissingQuestionNudge,
  buildPrematureWrapCorrection,
  buildResumeKickoffText,
  buildResumeSystemInstruction,
  buildSnippetReminder,
  buildSpeakNowFollowUp,
  buildTimeWrapDirector,
  resolveDirectorContext,
  resolveQuestionSource,
  TIME_WRAP_MANDATE,
} from '../../prompts/interview/live-session.prompt';
import { decideAiTurn } from './ai-turn';
import { candidateWantsToEnd, classifyCandidateAnswer, describeAnswerSignal } from './answer-signals';
import {
  appendTranscriptChunk,
  captionLooksIncomplete,
  containsLiveTranscriptArtifacts,
  estimateSpeechSec,
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

/** The interviewer only wraps up once this little time is left. */
const WRAP_UP_SEC = 120;
/** After time is up, give the browser this long to end the session itself. */
const TIME_EXPIRED_CLOSE_GRACE_MS = 15_000;
const PREMATURE_WRAP_PATTERN =
  /\b(time limitation|done from my end|out of time|running out of time|that concludes|conclude (the|our) interview|end (the|our) interview)\b/i;

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
  | { type: 'retryResponse' }
  | { type: 'end' };

const sendJson = (socket: WebSocket, payload: Record<string, unknown>): void => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
};

/** True when the interviewer turn already asked something the candidate must answer. */
const looksLikeInterviewQuestion = (text: string): boolean => {
  const t = text.trim();
  if (!t) return false;
  if (t.includes('?')) return true;
  return /(?:^|[.!] )\s*(?:what|why|how|when|where|which|tell me|explain|walk me|describe|can you|could you|would you|have you)\b/i.test(
    ` ${t}`,
  );
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
    /** Set after activityEnd until the model produces the next assistant turn. */
    let awaitingAiResponse = false;
    /** After a delivered question, drop further AI speech until the candidate submits. */
    let awaitingCandidateAnswer = false;
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
    /** Director for the current answer; reused by the empty-turn and latency nudges. */
    let currentFollowUpDirector = '';
    /** One "you forgot to ask a question" nudge per candidate answer. */
    let missingQuestionNudgeSent = false;
    /** Last answer asked to finish, so an early closing line is legitimate. */
    let candidateAskedToEnd = false;

    const clearKickoffRetry = (): void => {
      if (kickoffRetryTimer) {
        clearTimeout(kickoffRetryTimer);
        kickoffRetryTimer = null;
      }
    };

    let aiResponseWatchdogTimer: NodeJS.Timeout | null = null;
    /** True from sendClientContent until that generation's turnComplete. A second prompt here closes Gemini. */
    let modelTurnInFlight = false;
    let modelTurnStartedAt = 0;
    let openingInFlight = false;
    let kickoffAttempts = 0;
    let silentReplyRetries = 0;
    let replyWatchExtensions = 0;
    let geminiGeneration = 0;
    let geminiReconnects = 0;
    /** Groups one interviewer reply so a late chunk cannot paint over the next turn. */
    let speechTurn = 0;
    let speechTurnOpen = false;
    const currentSpeechTurn = (): number => {
      if (!speechTurnOpen) {
        speechTurn += 1;
        speechTurnOpen = true;
      }
      return speechTurn;
    };
    const closeSpeechTurn = (): void => {
      speechTurnOpen = false;
    };
    const MAX_KICKOFF_ATTEMPTS = 4;
    const MAX_GEMINI_RECONNECTS = 2;

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
          let timer: Awaited<ReturnType<typeof syncInterviewTimer>>;
          try {
            timer = await syncInterviewTimer(interviewId);
          } catch (error) {
            if (error instanceof Error && /already completed/i.test(error.message)) {
              logger.info(`[v2-live-interview] interview completed, closing live session interviewId=${interviewId}`);
              closeAll('interview_completed');
              return;
            }
            throw error;
          }
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

      const reviseCandidateText = (previousText: string, nextText: string): void => {
        enqueuePersist(async () => {
          const result = await reviseCandidateAnswer(interviewId, previousText, nextText);
          if (!result) return;
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
            clearTimerTick();
            logger.info(`[v2-live-interview] time expired interviewId=${interviewId}`);
            sendJson(clientSocket, { type: 'time_expired' });
            setTimeout(() => closeAll('time_expired'), TIME_EXPIRED_CLOSE_GRACE_MS);
            return;
          }

          // One-shot safety-net reminder past the session's midpoint if the snippet-question
          // minimum (see CODE SNIPPET QUESTIONS in interview-prompt.ts) has not yet been met.
          // Sent as context only (turnComplete: false) so it never interrupts the live turn-taking.
          if (!snippetReminderSent && geminiSession && !modelTurnInFlight) {
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
              const reminderText = buildSnippetReminder({
                asked: codeSnippetQuestionsAsked,
                required,
                isJdInterview,
              });
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

          if (remaining > 0 && remaining <= WRAP_UP_SEC && !timeWrapReminderSent && geminiSession && !modelTurnInFlight) {
            timeWrapReminderSent = true;
            try {
              geminiSession.sendClientContent({
                turns: [
                  {
                    role: 'user',
                    parts: [{ text: TIME_WRAP_MANDATE }],
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
      /** PCM16 16 kHz audio for the open candidate turn, transcribed when the client sent no caption. */
      let userPcmChunks: Buffer[] = [];
      let userPcmBytes = 0;
      const MAX_USER_PCM_BYTES = 16000 * 2 * 90;
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

      let sendModelPrompt: (text: string) => boolean = () => false;
      let sendKickoff: () => void = () => undefined;
      let armReplyWatchdog: () => void = () => undefined;
      let recoverSilentReply: () => void = () => undefined;
      let reconnectGemini: (reason: string) => void = () => undefined;
      let openGeminiSession: () => Promise<void> = async () => undefined;

      const handleGeminiMessage = (message: LiveServerMessage): void => {
        if (message.toolCall?.functionCalls?.length) {
          handleToolCall(message.toolCall.functionCalls);
        }

        const serverContent = message.serverContent;
        if (!serverContent) return;

        if (serverContent.interrupted) {
          // Keep buffers. Clearing them dropped the question/answer that was already spoken.
          sendJson(clientSocket, { type: 'interrupted' });
          return;
        }

        const onFirstAiSignal = (): void => {
          if (firstAiSignalReceived) return;
          firstAiSignalReceived = true;
          geminiReconnects = 0;
          silentReplyRetries = 0;
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

        const holdNextQuestion = awaitingCandidateAnswer && !awaitingAiResponse;
        // Resume opens the mic immediately. Until the first interviewer words of this
        // connection are delivered, that open mic must not swallow the re-asked question.
        const suppressAi =
          firstAiSignalReceived &&
          (holdNextQuestion || (userTurnOpen && receivedUserAudioThisTurn));

        if (serverContent.outputTranscription?.text) {
          // Keep assembling the question even if a user turn opened early; otherwise the
          // final interviewer line is wiped and the spoken question no longer matches the UI.
          const chunk = serverContent.outputTranscription.text;
          if (!suppressAi) {
            clearAiResponseWatchdog();
            onFirstAiSignal();
            aiTranscriptBuffer = appendTranscriptChunk(aiTranscriptBuffer, chunk);
            const text = sanitizeLiveTranscript(aiTranscriptBuffer);
            if (text) {
              sendJson(clientSocket, {
                type: 'transcript',
                role: 'ai',
                text,
                final: false,
                turnId: currentSpeechTurn(),
              });
            }
          }
        }

        const parts = serverContent.modelTurn?.parts ?? [];
        for (const part of parts) {
          const data = part.inlineData?.data;
          if (!data) continue;
          // Hold AI audio after a delivered question until Submit, and while the candidate is speaking.
          if (suppressAi) {
            continue;
          }
          clearAiResponseWatchdog();
          onFirstAiSignal();
          sendJson(clientSocket, {
            type: 'audio',
            data,
            mimeType: part.inlineData?.mimeType ?? 'audio/pcm;rate=24000',
            turnId: currentSpeechTurn(),
          });
        }

        if (serverContent.turnComplete) {
          clearAiResponseWatchdog();
          modelTurnInFlight = false;
          openingInFlight = false;
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
          const remainingNow = computeRemainingSeconds(latestInterview ?? interview);
          const decision = decideAiTurn({
            text: aiText,
            suppressed: suppressAi,
            firstSignalReceived: firstAiSignalReceived,
            awaitingReply: awaitingAiResponse,
            looksLikeQuestion: looksLikeInterviewQuestion(aiText),
            alreadyNudged: missingQuestionNudgeSent,
            timeWrapSent: timeWrapReminderSent,
            prematureWrap:
              !!aiText &&
              !timeWrapReminderSent &&
              !candidateAskedToEnd &&
              remainingNow > WRAP_UP_SEC &&
              PREMATURE_WRAP_PATTERN.test(aiText),
            canPrompt: !!geminiSession,
          });
          if (decision.action === 'drop') {
            // One interviewer response per answer. Extra turns wait until Submit.
            logger.info(
              `[v2-live-interview] dropped extra AI turn while waiting for submit interviewId=${interviewId}`,
            );
            aiTranscriptBuffer = '';
            return;
          }
          if (decision.action === 'ignore_empty') {
            // A blank turnComplete is the model finishing without speech. The microphone
            // stays closed, and a new prompt is sent only after this generation has ended.
            logger.warn(
              `[v2-live-interview] empty AI turn interviewId=${interviewId} opening=${!firstAiSignalReceived} awaitingReply=${awaitingAiResponse}`,
            );
            aiTranscriptBuffer = '';
            if (!firstAiSignalReceived) {
              clearKickoffRetry();
              kickoffRetryTimer = setTimeout(() => {
                kickoffRetryTimer = null;
                sendKickoff();
              }, 600);
            } else {
              recoverSilentReply();
            }
            return;
          }
          if (aiText) {
            sendJson(clientSocket, {
              type: 'transcript',
              role: 'ai',
              text: aiText,
              final: true,
              turnId: currentSpeechTurn(),
            });
            persistAssistantText(aiText);
            awaitingAiResponse = false;
            if (decision.action === 'correct_wrap') {
              logger.warn(
                `[v2-live-interview] premature wrap-up with ${remainingNow}s left, correcting interviewId=${interviewId}`,
              );
              awaitingAiResponse = true;
              sendModelPrompt(buildPrematureWrapCorrection(Math.floor(remainingNow / 60)));
              armReplyWatchdog();
              aiTranscriptBuffer = '';
              return;
            }
            if (decision.action === 'nudge_for_question') {
              missingQuestionNudgeSent = true;
              awaitingAiResponse = true;
              logger.warn(
                `[v2-live-interview] AI reply had no question, nudging interviewId=${interviewId}`,
              );
              sendModelPrompt(buildMissingQuestionNudge());
              armReplyWatchdog();
              aiTranscriptBuffer = '';
              return;
            }
            if (decision.action === 'deliver' && decision.awaitAnswer) {
              // This reply is the one turn. Wait for Submit instead of speaking another question.
              awaitingCandidateAnswer = true;
            }
          }
          aiTranscriptBuffer = '';
          closeSpeechTurn();
          sendJson(clientSocket, { type: 'turnComplete', turnId: speechTurn });
        }
      };

      const lastAssistantQuestionText = (): string =>
        [...((latestInterview ?? interview).conversation ?? [])]
          .reverse()
          .find((entry) => entry.role === 'assistant')?.text ?? '';

      sendModelPrompt = (text: string): boolean => {
        const prompt = text.trim();
        if (!prompt || !geminiSession || closed) return false;
        // Overlapping client content is what closes the Gemini socket mid-interview.
        if (modelTurnInFlight) {
          logger.warn(`[v2-live-interview] skipped overlapping prompt interviewId=${interviewId}`);
          return false;
        }
        try {
          geminiSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: prompt }] }],
            turnComplete: true,
          });
          modelTurnInFlight = true;
          modelTurnStartedAt = Date.now();
          return true;
        } catch (error) {
          modelTurnInFlight = false;
          logger.warn(`[v2-live-interview] prompt failed interviewId=${interviewId}`, error);
          return false;
        }
      };

      armReplyWatchdog = (): void => {
        clearAiResponseWatchdog();
        aiResponseWatchdogTimer = setTimeout(() => {
          aiResponseWatchdogTimer = null;
          if (!awaitingAiResponse || !geminiSession || closed) return;
          if (modelTurnInFlight) {
            if (replyWatchExtensions < 1) {
              replyWatchExtensions += 1;
              logger.warn(
                `[v2-live-interview] reply still generating, waiting longer interviewId=${interviewId}`,
              );
              armReplyWatchdog();
              return;
            }
            logger.warn(`[v2-live-interview] reply hung, reconnecting interviewId=${interviewId}`);
            modelTurnInFlight = false;
            reconnectGemini('reply_hung');
            return;
          }
          recoverSilentReply();
        }, 16_000);
      };

      recoverSilentReply = (): void => {
        if (closed || !awaitingAiResponse) return;
        if (silentReplyRetries >= 1) {
          reconnectGemini('silent_reply');
          return;
        }
        silentReplyRetries += 1;
        const doc = latestInterview ?? interview;
        const { lastQuestion } = resolveDirectorContext(doc.conversation);
        const answer = [...(doc.conversation ?? [])]
          .reverse()
          .find((entry) => entry.role === 'candidate')?.text;
        logger.warn(`[v2-live-interview] empty AI reply, asking it to speak interviewId=${interviewId}`);
        if (sendModelPrompt(buildSpeakNowFollowUp(doc, lastQuestion, answer))) {
          armReplyWatchdog();
        }
      };

      sendKickoff = (): void => {
        if (!geminiSession || firstAiSignalReceived || closed || openingInFlight || modelTurnInFlight) return;
        if (kickoffAttempts >= MAX_KICKOFF_ATTEMPTS) {
          reconnectGemini('kickoff_exhausted');
          return;
        }
        kickoffAttempts += 1;
        const kickoffText = buildResumeKickoffText(
          resumeMode,
          lastAssistantQuestionText(),
          latestInterview || interview,
          kickoffAttempts,
        );
        if (!kickoffText) return;
        userTurnOpen = false;
        openingInFlight = true;
        if (!sendModelPrompt(kickoffText)) {
          openingInFlight = false;
          return;
        }
        logger.info(
          `[v2-live-interview] kickoff sent interviewId=${interviewId} attempt=${kickoffAttempts} mode=${resumeMode}`,
        );
        clearKickoffRetry();
        kickoffRetryTimer = setTimeout(() => {
          kickoffRetryTimer = null;
          if (firstAiSignalReceived || !geminiSession || closed) return;
          if (modelTurnInFlight) {
            logger.warn(`[v2-live-interview] opening hung, reconnecting interviewId=${interviewId}`);
            openingInFlight = false;
            modelTurnInFlight = false;
            reconnectGemini('opening_hung');
            return;
          }
          openingInFlight = false;
          logger.warn(
            `[v2-live-interview] no opening response yet, retrying kickoff interviewId=${interviewId} attempt=${kickoffAttempts + 1}`,
          );
          sendKickoff();
        }, 18_000);
      };

      reconnectGemini = (reason: string): void => {
        if (closed) return;
        if (clientSocket.readyState !== WebSocket.OPEN) {
          closeAll('gemini_closed');
          return;
        }
        if (geminiReconnects >= MAX_GEMINI_RECONNECTS) {
          logger.warn(
            `[v2-live-interview] Gemini reconnects exhausted interviewId=${interviewId} reason=${reason}`,
          );
          closeAll('gemini_closed');
          return;
        }
        geminiReconnects += 1;
        logger.warn(
          `[v2-live-interview] reconnecting Gemini interviewId=${interviewId} reason=${reason} attempt=${geminiReconnects}`,
        );
        kickoffAttempts = 0;
        openingInFlight = false;
        modelTurnInFlight = false;
        silentReplyRetries = 0;
        replyWatchExtensions = 0;
        clearKickoffRetry();
        clearAiResponseWatchdog();
        void openGeminiSession().catch((error) => {
          logger.error(`[v2-live-interview] Gemini reconnect failed interviewId=${interviewId}`, error);
          closeAll('gemini_closed');
        });
      };

      openGeminiSession = async (): Promise<void> => {
        const generation = ++geminiGeneration;
        const previous = geminiSession;
        geminiSession = null;
        try {
          previous?.close();
        } catch {
          // already closed
        }

        const session = await getClient().live.connect({
          model,
          config: buildLiveConnectConfig(systemInstructions, [buildCodeSnippetTool()]),
          callbacks: {
            onopen: () => {
              if (generation !== geminiGeneration) return;
              logger.info(`[v2-live-interview] Gemini session open interviewId=${interviewId}`);
              if (geminiReconnects === 0) {
                sendJson(clientSocket, { type: 'open' });
              }
            },
            onmessage: (message) => {
              if (generation !== geminiGeneration) return;
              handleGeminiMessage(message);
            },
            onerror: (event) => {
              if (generation !== geminiGeneration) return;
              const message =
                event instanceof ErrorEvent && event.error instanceof Error
                  ? event.error.message
                  : 'Live interview connection error.';
              logger.error('[v2-live-interview] Gemini error', message);
            },
            onclose: () => {
              if (generation !== geminiGeneration || closed) return;
              logger.info(`[v2-live-interview] Gemini session closed interviewId=${interviewId}`);
              reconnectGemini('gemini_closed');
            },
          },
        });

        if (generation !== geminiGeneration || closed) {
          try {
            session.close();
          } catch {
            // already closed
          }
          return;
        }
        geminiSession = session;

        // Saved conversation already lives in the system instruction. Replaying it as
        // client content made the first turn complete with no audio.
        if (!firstAiSignalReceived) {
          sendKickoff();
          return;
        }
        if (awaitingAiResponse) {
          const doc = latestInterview ?? interview;
          const { lastQuestion } = resolveDirectorContext(doc.conversation);
          const answer = [...(doc.conversation ?? [])]
            .reverse()
            .find((entry) => entry.role === 'candidate')?.text;
          sendModelPrompt(buildSpeakNowFollowUp(doc, lastQuestion, answer) || currentFollowUpDirector);
          armReplyWatchdog();
          return;
        }
        awaitingCandidateAnswer = false;
        awaitingAiResponse = true;
        const replay = buildResumeKickoffText(
          'await_candidate',
          lastAssistantQuestionText(),
          latestInterview || interview,
          3,
        );
        if (replay) sendModelPrompt(replay);
      };

      await openGeminiSession();

      const respondToCandidateAnswer = async (clientCaption: string, pcm: Buffer): Promise<void> => {
        let captionText = clientCaption;
        const speechSec = pcm.length > 0 ? estimateSpeechSec(pcm) : 0;
        // Near-silence with no caption was being transcribed into a made-up answer, which
        // then collided with the interviewer's in-flight turn and produced an empty reply.
        if (!captionText.trim() && speechSec < 0.4) {
          logger.warn(
            `[v2-live-interview] ignored silent answer interviewId=${interviewId} speechSec=${speechSec.toFixed(2)}`,
          );
          awaitingAiResponse = false;
          if (firstAiSignalReceived) {
            awaitingCandidateAnswer = true;
            sendJson(clientSocket, { type: 'listen_again' });
          }
          return;
        }
        clearKickoffRetry();
        if (pcm.length > 0 && speechSec >= 0.4 && captionLooksIncomplete(clientCaption, speechSec)) {
          let heard = '';
          try {
            const timeoutMs = Math.min(12_000, 4_500 + speechSec * 100);
            heard = sanitizeLiveTranscript(await transcribeInterviewAudio(pcm, 16000, timeoutMs));
          } catch (error) {
            logger.warn(`[v2-live-interview] answer transcription failed interviewId=${interviewId}`, error);
          }
          const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;
          if (heard && isLatinEnglishCaption(heard) && wordCount(heard) > wordCount(clientCaption)) {
            captionText = heard;
            sendJson(clientSocket, {
              type: 'transcript',
              role: 'user',
              text: captionText,
              final: true,
              revised: true,
            });
            if (clientCaption) {
              reviseCandidateText(clientCaption, captionText);
            } else {
              persistCandidateText(captionText);
            }
          }
          logger.info(
            `[v2-live-interview] caption check interviewId=${interviewId} speechSec=${speechSec.toFixed(1)} client="${clientCaption}" heard="${heard}" used=${captionText === clientCaption ? 'client' : 'audio'}`,
          );
        }
        if (closed || !geminiSession) return;

        const { lastQuestion, recent } = resolveDirectorContext(
          (latestInterview ?? interview).conversation,
        );
        const answerSignal = classifyCandidateAnswer(lastQuestion, captionText);
        candidateAskedToEnd = candidateWantsToEnd(captionText);
        logger.info(
          `[v2-live-interview] candidate answer interviewId=${interviewId} source=${captionText === clientCaption ? 'client' : 'audio'} signal=${answerSignal} speechSec=${speechSec.toFixed(1)} text="${captionText}"`,
        );

        const remainingSecs = broadcastTimer();
        const shouldWrap = remainingSecs > 0 && remainingSecs <= WRAP_UP_SEC && !timeWrapReminderSent;
        const followUpDirector = shouldWrap
          ? buildTimeWrapDirector(captionText)
          : buildInteractiveFollowUpDirector({
              lastQuestion,
              candidateText: captionText,
              recent,
              signalNote: describeAnswerSignal(answerSignal),
              questionSource: resolveQuestionSource(latestInterview ?? interview),
            });
        currentFollowUpDirector = followUpDirector;
        silentReplyRetries = 0;
        replyWatchExtensions = 0;
        if (shouldWrap) {
          timeWrapReminderSent = true;
        }

        if (!sendModelPrompt(followUpDirector)) {
          logger.warn(`[v2-live-interview] follow-up director was not sent interviewId=${interviewId}`);
        }
        armReplyWatchdog();
      };

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
          userPcmChunks = [];
          userPcmBytes = 0;
          userTurnOpen = true;
          return;
        }

        if (message.type === 'activityEnd') {
          userTurnOpen = false;
          const pcm = userPcmChunks.length ? Buffer.concat(userPcmChunks) : Buffer.alloc(0);
          userPcmChunks = [];
          userPcmBytes = 0;
          const clientCaption = pendingCandidateText?.trim() ?? '';
          pendingCandidateText = '';

          awaitingAiResponse = true;
          awaitingCandidateAnswer = false;
          missingQuestionNudgeSent = false;
          void respondToCandidateAnswer(clientCaption, pcm);
          return;
        }

        if (message.type === 'audio' && message.data) {
          // Audio is buffered for transcription only. Gemini receives the answer as text so it
          // replies exactly once, to the same words the candidate sees in "Your Answer".
          if (!userTurnOpen && !awaitingAiResponse) {
            userTurnOpen = true;
            receivedUserAudioThisTurn = false;
            userAudioChunksCount = 0;
            userAudioBytesTotal = 0;
            userPcmChunks = [];
            userPcmBytes = 0;
          }
          if (userTurnOpen) {
            receivedUserAudioThisTurn = true;
            userAudioChunksCount++;
            const chunk = Buffer.from(message.data, 'base64');
            userAudioBytesTotal += chunk.length;
            if (userPcmBytes + chunk.length <= MAX_USER_PCM_BYTES) {
              userPcmChunks.push(chunk);
              userPcmBytes += chunk.length;
            }
          }
          return;
        }

        if (message.type === 'retryResponse') {
          logger.warn(`[v2-live-interview] client requested reply retry interviewId=${interviewId}`);
          if (modelTurnInFlight && Date.now() - modelTurnStartedAt < 20_000) {
            return;
          }
          if (!firstAiSignalReceived) {
            openingInFlight = false;
            modelTurnInFlight = false;
            clearKickoffRetry();
            if (kickoffAttempts >= MAX_KICKOFF_ATTEMPTS) {
              kickoffAttempts = MAX_KICKOFF_ATTEMPTS - 1;
            }
            sendKickoff();
            return;
          }
          if (awaitingCandidateAnswer && !awaitingAiResponse) {
            return;
          }
          modelTurnInFlight = false;
          awaitingAiResponse = true;
          silentReplyRetries = 0;
          recoverSilentReply();
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
