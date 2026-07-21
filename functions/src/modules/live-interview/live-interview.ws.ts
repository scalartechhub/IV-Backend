import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { IncomingMessage, Server } from "http";
import { URL } from "url";
import type { Session } from "@google/genai";
import { auth } from "../../config/firebase";
import { logger } from "../../shared/logger";
import { isCloudRuntime } from "../../shared/runtime";
import * as repo from "../interview/interview.repository";
import type {
  Interview,
  InterviewConversationMessage,
  LiveTurnCommitResult,
} from "../interview/interview.types";
import { InterviewStatus } from "../interview/interview.types";
import {
  createGeminiLiveBridge,
  forwardAudioToGemini,
  forwardAudioTurnComplete,
  forwardTextToGemini,
  injectSystemContextToGemini,
} from "./live-interview.gemini-bridge";
import { buildTimeUpdateContext } from "./live-interview.prompt";
import type {
  LiveClientMessage,
  LiveResumeMode,
  LiveTranscriptEntry,
  PersistedTurnPayload,
} from "./live-interview.types";

const LIVE_WS_PATH = "/ws/interview";
const TIMER_TICK_INTERVAL_MS = 30_000;
/** Inject Gemini pacing context when remaining time crosses these thresholds (seconds). */
const TIME_CONTEXT_THRESHOLDS = [
  3_600, 2_700, 1_800, 1_200, 900, 600, 300, 180, 120,
];

interface ActiveLiveSession {
  interviewId: string;
  userId: string;
  transcript: LiveTranscriptEntry[];
  geminiSession: Session | null;
  closeBridge: () => void;
  persistQueue: Promise<void>;
  skipCandidatePersist: boolean;
}

/** Soft takeover: newest socket wins. */
const activeByInterviewId = new Map<string, WebSocket>();
const activeSessions = new Map<WebSocket, ActiveLiveSession>();

const sendJson = (socket: WebSocket, payload: Record<string, unknown>): void => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
};

const parseClientMessage = (raw: RawData): LiveClientMessage | null => {
  try {
    const parsed = JSON.parse(raw.toString()) as LiveClientMessage;
    if (!parsed?.type) return null;
    return parsed;
  } catch {
    return null;
  }
};

const verifyTokenFromRequest = async (req: IncomingMessage): Promise<string> => {
  const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
  const token = url.searchParams.get("token")?.trim();
  if (!token) {
    throw new Error("Missing authentication token");
  }
  const decoded = await auth.verifyIdToken(token);
  return decoded.uid;
};

const getInterviewIdFromRequest = (req: IncomingMessage): string => {
  const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
  const interviewId = url.searchParams.get("interviewId")?.trim();
  if (!interviewId) {
    throw new Error("Missing interviewId");
  }
  return interviewId;
};

const toPersistedPayload = (result: LiveTurnCommitResult): PersistedTurnPayload => ({
  message: result.message,
  conversation: result.interview.conversation ?? [],
  lastSpeaker: result.interview.lastSpeaker ?? null,
  currentQuestionId: result.interview.currentQuestionId,
  currentQuestionIndex: result.interview.currentQuestionIndex,
  remainingSeconds: result.interview.remainingSeconds,
  currentTopic: result.interview.currentTopic,
  currentDifficulty: result.interview.currentDifficulty,
  questionStartTime: result.interview.questionStartTime,
  created: result.created,
});

const resolveResumeMode = (interview: Interview): LiveResumeMode => {
  const conversation = interview.conversation ?? [];
  if (!conversation.length) return "fresh";
  if (interview.lastSpeaker === "candidate") return "generate_next";
  if (interview.lastSpeaker === "assistant") return "await_candidate";

  const last = conversation[conversation.length - 1];
  if (last?.role === "candidate") return "generate_next";
  if (last?.role === "assistant") return "await_candidate";
  return "fresh";
};

const enqueueSessionPersist = (
  session: ActiveLiveSession,
  task: () => Promise<void>
): Promise<void> => {
  const operation = session.persistQueue
    .catch(() => undefined)
    .then(task)
  session.persistQueue = operation.catch((error) => {
      logger.error(
        `[live-interview] serialized persist failed interviewId=${session.interviewId}`,
        error
      );
    });
  return operation;
};

const takeoverExistingSession = (interviewId: string, nextSocket: WebSocket): void => {
  const previous = activeByInterviewId.get(interviewId);
  if (!previous || previous === nextSocket) return;

  const previousSession = activeSessions.get(previous);
  sendJson(previous, {
    type: "error",
    code: "session_replaced",
    message: "This interview was taken over by another session on your account.",
  });
  sendJson(previous, {
    type: "sessionClosed",
    reason: "session_replaced",
    message: "Session replaced by a newer connection.",
  });

  try {
    previousSession?.closeBridge();
  } catch {
    // ignore
  }
  try {
    previous.close();
  } catch {
    // ignore
  }

  activeSessions.delete(previous);
  activeByInterviewId.delete(interviewId);
};

export const broadcastInterviewCompleted = (interviewId: string): void => {
  const socket = activeByInterviewId.get(interviewId);
  if (!socket) return;
  sendJson(socket, {
    type: "interview_completed",
    message: "Interview completed. Report generation finished.",
  });
};

/** Wait for in-flight live-session writes before reading interview state (e.g. on finish). */
export const awaitLiveSessionPersist = async (interviewId: string): Promise<void> => {
  const socket = activeByInterviewId.get(interviewId);
  if (!socket) return;
  const session = activeSessions.get(socket);
  if (!session) return;
  await session.persistQueue.catch(() => undefined);
};

export const setupLiveInterviewWebSocket = (server: Server): void => {
  if (isCloudRuntime()) {
    logger.warn(
      "[live-interview] WebSocket server skipped on Cloud Functions runtime - use Render/local Node server"
    );
    return;
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== LIVE_WS_PATH) {
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", async (clientSocket, req) => {
    let bridgeClose: (() => void) | null = null;
    let interviewIdForCleanup = "";
    let timerTickId: ReturnType<typeof setInterval> | null = null;
    let lastInjectedThreshold = Number.POSITIVE_INFINITY;
    let latestInterviewRef: Interview | null = null;

    const clearTimerTick = (): void => {
      if (timerTickId != null) {
        clearInterval(timerTickId);
        timerTickId = null;
      }
    };

    try {
      const userId = await verifyTokenFromRequest(req);
      const interviewId = getInterviewIdFromRequest(req);
      interviewIdForCleanup = interviewId;

      let interview = await repo.requireOwnedInterview(interviewId, userId);

      if (interview.status === InterviewStatus.COMPLETED) {
        sendJson(clientSocket, { type: "error", message: "Interview is already completed." });
        clientSocket.close();
        return;
      }
      if (interview.status === InterviewStatus.CANCELLED) {
        sendJson(clientSocket, { type: "error", message: "Interview was cancelled." });
        clientSocket.close();
        return;
      }

      takeoverExistingSession(interviewId, clientSocket);
      // Claim ownership before any awaited setup so a newer concurrent socket
      // can replace this one deterministically.
      activeByInterviewId.set(interviewId, clientSocket);

      const started = await repo.markInterviewStarted(interviewId);
      interview = {
        ...started.interview,
        // Derive elapsed time in memory; never perform reconnect/tick-only writes.
        remainingSeconds: repo.computeRemainingSeconds(started.interview),
      };
      latestInterviewRef = interview;

      const resumeMode = resolveResumeMode(interview);
      const isResume = resumeMode !== "fresh";

      const transcript: LiveTranscriptEntry[] = [];
      let beginAwaitingUserTranscript: (() => void) | null = null;
      const sessionState: ActiveLiveSession = {
        interviewId,
        userId,
        transcript,
        geminiSession: null,
        closeBridge: () => undefined,
        persistQueue: Promise.resolve(),
        skipCandidatePersist: false,
      };

      const persistCandidate = async (text: string): Promise<PersistedTurnPayload | null> => {
        if (activeByInterviewId.get(interviewId) !== clientSocket) return null;
        const result = await repo.appendLiveCandidateAnswer(interviewId, text);
        return toPersistedPayload(result);
      };

      const persistAssistant = async (text: string): Promise<PersistedTurnPayload | null> => {
        if (activeByInterviewId.get(interviewId) !== clientSocket) return null;
        const result = await repo.appendLiveAssistantQuestion(interviewId, text);
        return toPersistedPayload(result);
      };

      const bridge = await createGeminiLiveBridge({
        interview,
        clientSocket,
        resumeMode,
        onTranscript: (entry) => transcript.push(entry),
        onSessionEnd: () => {
          activeSessions.delete(clientSocket);
          if (activeByInterviewId.get(interviewId) === clientSocket) {
            activeByInterviewId.delete(interviewId);
          }
        },
        onSessionReady: (geminiSession) => {
          sessionState.geminiSession = geminiSession;
        },
        onFinalizedCandidateAnswer: async (text) => {
          let payload: PersistedTurnPayload | null = null;
          await enqueueSessionPersist(sessionState, async () => {
            payload = await persistCandidate(text);
          });
          return payload;
        },
        onFinalizedAiQuestion: async (text) => {
          let payload: PersistedTurnPayload | null = null;
          await enqueueSessionPersist(sessionState, async () => {
            payload = await persistAssistant(text);
          });
          return payload;
        },
        shouldSkipCandidatePersist: () => sessionState.skipCandidatePersist,
        clearSkipCandidatePersist: () => {
          sessionState.skipCandidatePersist = false;
        },
      });

      sessionState.closeBridge = bridge.close;
      sessionState.geminiSession = bridge.session;
      beginAwaitingUserTranscript = bridge.beginAwaitingUserTranscript;
      activeSessions.set(clientSocket, sessionState);
      bridgeClose = bridge.close;

      const durationMinutes =
        typeof interview.durationMinutes === "number" && interview.durationMinutes > 0
          ? interview.durationMinutes
          : 45;

      const broadcastRemainingTime = (): number => {
        if (!latestInterviewRef) return 0;
        const remaining = repo.computeRemainingSeconds(latestInterviewRef);
        latestInterviewRef = { ...latestInterviewRef, remainingSeconds: remaining };
        sendJson(clientSocket, { type: "timer_tick", remainingSeconds: remaining });
        return remaining;
      };

      const maybeInjectTimeContext = (remaining: number): void => {
        const geminiSession = sessionState.geminiSession;
        if (!geminiSession || remaining <= 0) return;

        const threshold = TIME_CONTEXT_THRESHOLDS.find(
          (value) => remaining <= value && value < lastInjectedThreshold
        );
        if (threshold == null) return;

        lastInjectedThreshold = threshold;
        try {
          injectSystemContextToGemini(
            geminiSession,
            buildTimeUpdateContext(remaining, durationMinutes)
          );
        } catch (error) {
          logger.warn(
            `[live-interview] Time context injection failed interviewId=${interviewId}`,
            error
          );
        }
      };

      timerTickId = setInterval(() => {
        if (activeByInterviewId.get(interviewId) !== clientSocket) return;
        const remaining = broadcastRemainingTime();
        maybeInjectTimeContext(remaining);
      }, TIMER_TICK_INTERVAL_MS);

      const initialRemaining = broadcastRemainingTime();
      maybeInjectTimeContext(initialRemaining);

      const conversation: InterviewConversationMessage[] = interview.conversation ?? [];

      if (started.created) {
        sendJson(clientSocket, {
          type: "interview_started",
          status: interview.status,
          conversation,
          lastSpeaker: interview.lastSpeaker ?? null,
          remainingSeconds: interview.remainingSeconds,
          startedAt: interview.startedAt,
        });
      }

      if (isResume) {
        sendJson(clientSocket, {
          type: "interview_resumed",
          status: interview.status,
          conversation,
          lastSpeaker: interview.lastSpeaker ?? null,
          currentQuestionIndex: interview.currentQuestionIndex ?? -1,
          currentQuestionId: interview.currentQuestionId,
          remainingSeconds: interview.remainingSeconds,
          startedAt: interview.startedAt,
          questionStartTime: interview.questionStartTime,
          currentTopic: interview.currentTopic,
          currentDifficulty: interview.currentDifficulty,
        });
        sendJson(clientSocket, {
          type: "conversation_updated",
          conversation,
          lastSpeaker: interview.lastSpeaker ?? null,
        });
      }

      clientSocket.on("message", (raw) => {
        void (async () => {
          try {
            const message = parseClientMessage(raw);
            if (!message) return;
            if (activeByInterviewId.get(interviewId) !== clientSocket) return;

            const geminiSession = sessionState.geminiSession;
            if (!geminiSession) return;

            if (message.type === "audio" && message.data) {
              forwardAudioToGemini(
                geminiSession,
                message.data,
                message.mimeType ?? "audio/pcm;rate=16000"
              );
              return;
            }

            if (message.type === "text" && message.text.trim()) {
              const answer = message.text.trim();

              // Persist text answers once here so Gemini STT/transcript cannot double-write.
              let persisted: PersistedTurnPayload | null = null;
              await enqueueSessionPersist(sessionState, async () => {
                persisted = await persistCandidate(answer);
                if (persisted?.created) {
                  sessionState.skipCandidatePersist = true;
                }
              });

              if (persisted) {
                const payload = persisted as PersistedTurnPayload;
                if (payload.created) {
                  latestInterviewRef = {
                    ...(latestInterviewRef ?? interview),
                    remainingSeconds: payload.remainingSeconds,
                  };
                  sendJson(clientSocket, {
                    type: "userAnswerFinal",
                    id: payload.message.id,
                    questionId: payload.message.questionId,
                    text: payload.message.message,
                    message: payload.message.message,
                    conversation: payload.conversation,
                    lastSpeaker: payload.lastSpeaker,
                    remainingSeconds: payload.remainingSeconds,
                  });
                  sendJson(clientSocket, {
                    type: "candidate_answer_saved",
                    id: payload.message.id,
                    questionId: payload.message.questionId,
                    text: payload.message.message,
                    message: payload.message.message,
                    conversation: payload.conversation,
                    lastSpeaker: payload.lastSpeaker,
                    remainingSeconds: payload.remainingSeconds,
                  });
                  sendJson(clientSocket, {
                    type: "conversation_updated",
                    conversation: payload.conversation,
                    lastSpeaker: payload.lastSpeaker,
                  });
                } else {
                  return;
                }
              }

              forwardTextToGemini(geminiSession, answer);
              return;
            }

            if (message.type === "audioComplete") {
              beginAwaitingUserTranscript?.();
              forwardAudioTurnComplete(geminiSession);
              return;
            }

            if (message.type === "end") {
              clearTimerTick();
              sendJson(clientSocket, { type: "ended" });
              bridge.close();
              clientSocket.close();
            }
          } catch (error) {
            const errMessage =
              error instanceof Error ? error.message : "Failed to process live message";
            logger.error("[live-interview] message handling failed", error);
            sendJson(clientSocket, { type: "error", message: errMessage });
          }
        })();
      });
    } catch (error) {
      clearTimerTick();
      const message = error instanceof Error ? error.message : "Failed to start live session";
      logger.error("[live-interview] connection failed", error);
      sendJson(clientSocket, { type: "error", message });
      if (
        interviewIdForCleanup &&
        activeByInterviewId.get(interviewIdForCleanup) === clientSocket
      ) {
        activeByInterviewId.delete(interviewIdForCleanup);
      }
      clientSocket.close();
      return;
    }

    clientSocket.on("close", () => {
      clearTimerTick();
      bridgeClose?.();
      activeSessions.delete(clientSocket);
      if (
        interviewIdForCleanup &&
        activeByInterviewId.get(interviewIdForCleanup) === clientSocket
      ) {
        activeByInterviewId.delete(interviewIdForCleanup);
      }
    });

    clientSocket.on("error", (error) => {
      logger.error("[live-interview] client socket error", error);
      clearTimerTick();
      bridgeClose?.();
      activeSessions.delete(clientSocket);
      if (
        interviewIdForCleanup &&
        activeByInterviewId.get(interviewIdForCleanup) === clientSocket
      ) {
        activeByInterviewId.delete(interviewIdForCleanup);
      }
    });
  });

  logger.info(`[live-interview] WebSocket server ready at ${LIVE_WS_PATH}`);
};

export const getLiveWsPath = (): string => LIVE_WS_PATH;
