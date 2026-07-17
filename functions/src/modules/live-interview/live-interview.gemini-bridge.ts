import { Modality, type LiveServerMessage, type Session } from "@google/genai";
import { getGenAI } from "../../config/gemini";
import { appConfig } from "../../config/app.config";
import { logger } from "../../shared/logger";
import {
  buildLiveInterviewSystemInstruction,
  buildResumeKickoffText,
} from "./live-interview.prompt";
import type { Interview } from "../interview/interview.types";
import type {
  BrowserWebSocket,
  LiveResumeMode,
  LiveTranscriptEntry,
  PersistedTurnPayload,
} from "./live-interview.types";

export interface GeminiLiveBridgeOptions {
  interview: Interview;
  clientSocket: BrowserWebSocket;
  resumeMode?: LiveResumeMode;
  onTranscript: (entry: LiveTranscriptEntry) => void;
  onSessionEnd: () => void;
  onSessionReady?: (session: Session) => void;
  /**
   * Persist a finalized candidate answer. Called only after complete text is available.
   * Return null when skipped (e.g. already persisted via text path).
   */
  onFinalizedCandidateAnswer?: (text: string) => Promise<PersistedTurnPayload | null>;
  /** Persist a finalized AI question. Called only after streaming completes. */
  onFinalizedAiQuestion?: (text: string) => Promise<PersistedTurnPayload | null>;
  /** When true, skip voice/STT candidate persistence for the current turn (text already saved). */
  shouldSkipCandidatePersist?: () => boolean;
  /** Clear the skip flag after a turn completes. */
  clearSkipCandidatePersist?: () => void;
}

export interface GeminiLiveBridge {
  close: () => void;
  session: Session | null;
  /** Call when the client finishes sending a recorded answer — AI output is held until STT arrives. */
  beginAwaitingUserTranscript: () => void;
}

const USER_TRANSCRIPT_HOLD_TIMEOUT_MS = 8_000;

/** Strip Gemini STT artifacts like <noise> that should never appear in chat. */
const sanitizeUserTranscript = (text: string): string =>
  text
    .replace(/<\/?(?:noise|inaudible|unk|unknown|silence|other)\s*\/?>/gi, " ")
    .replace(/\[(?:noise|inaudible|unk|unknown|silence|other)\]/gi, " ")
    .replace(/\((?:noise|inaudible|unk|unknown|silence|other)\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const sendJson = (socket: BrowserWebSocket, payload: Record<string, unknown>): void => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
};

const appendTranscript = (
  transcript: LiveTranscriptEntry[],
  role: LiveTranscriptEntry["role"],
  text: string,
  onTranscript: (entry: LiveTranscriptEntry) => void
): void => {
  const trimmed = text.trim();
  if (!trimmed) return;
  const entry: LiveTranscriptEntry = { role, text: trimmed, timestamp: Date.now() };
  transcript.push(entry);
  onTranscript(entry);
};

const emitPersistedCandidate = (
  socket: BrowserWebSocket,
  payload: PersistedTurnPayload
): void => {
  if (!payload.created) return;
  const body = {
    id: payload.message.id,
    questionId: payload.message.questionId,
    text: payload.message.message,
    message: payload.message.message,
    conversation: payload.conversation,
    lastSpeaker: payload.lastSpeaker,
    currentQuestionId: payload.currentQuestionId,
    currentQuestionIndex: payload.currentQuestionIndex,
    remainingSeconds: payload.remainingSeconds,
    currentTopic: payload.currentTopic,
    currentDifficulty: payload.currentDifficulty,
    questionStartTime: payload.questionStartTime,
  };
  sendJson(socket, { type: "userAnswerFinal", ...body });
  sendJson(socket, { type: "candidate_answer_saved", ...body });
  sendJson(socket, {
    type: "conversation_updated",
    conversation: payload.conversation,
    lastSpeaker: payload.lastSpeaker,
  });
};

const emitPersistedAiQuestion = (
  socket: BrowserWebSocket,
  payload: PersistedTurnPayload
): void => {
  if (!payload.created) return;
  const body = {
    id: payload.message.id,
    questionId: payload.message.questionId,
    text: payload.message.message,
    message: payload.message.message,
    conversation: payload.conversation,
    lastSpeaker: payload.lastSpeaker,
    currentQuestionId: payload.currentQuestionId,
    currentQuestionIndex: payload.currentQuestionIndex,
    remainingSeconds: payload.remainingSeconds,
    currentTopic: payload.currentTopic,
    currentDifficulty: payload.currentDifficulty,
    questionStartTime: payload.questionStartTime,
  };
  sendJson(socket, { type: "aiQuestion", ...body });
  sendJson(socket, { type: "ai_question", ...body });
  sendJson(socket, {
    type: "conversation_updated",
    conversation: payload.conversation,
    lastSpeaker: payload.lastSpeaker,
  });
};

export const createGeminiLiveBridge = async (
  options: GeminiLiveBridgeOptions
): Promise<GeminiLiveBridge> => {
  const {
    interview,
    clientSocket,
    resumeMode = "fresh",
    onTranscript,
    onSessionEnd,
    onSessionReady,
    onFinalizedCandidateAnswer,
    onFinalizedAiQuestion,
    shouldSkipCandidatePersist,
    clearSkipCandidatePersist,
  } = options;
  const transcript: LiveTranscriptEntry[] = [];

  let userTranscriptBuffer = "";
  let aiTranscriptBuffer = "";
  let geminiSession: Session | null = null;
  let closed = false;
  let turnPersistQueue: Promise<void> = Promise.resolve();

  /** After audioComplete, hold AI audio/text until user STT is visible on the client. */
  let awaitingUserTranscript = false;
  let userTranscriptVisible = false;
  let pendingAiPayloads: Record<string, unknown>[] = [];
  let holdTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const clearHoldTimeout = (): void => {
    if (holdTimeoutId != null) {
      clearTimeout(holdTimeoutId);
      holdTimeoutId = null;
    }
  };

  const releaseAiHold = (): void => {
    clearHoldTimeout();
    const queued = pendingAiPayloads;
    pendingAiPayloads = [];
    for (const payload of queued) {
      sendJson(clientSocket, payload);
    }
  };

  const enqueueOrSendAi = (payload: Record<string, unknown>): void => {
    if (awaitingUserTranscript && !userTranscriptVisible) {
      pendingAiPayloads.push(payload);
      return;
    }
    sendJson(clientSocket, payload);
  };

  const markUserTranscriptVisible = (finalize: boolean): void => {
    const userText = sanitizeUserTranscript(userTranscriptBuffer);
    if (!userText) return;

    // Live captions only — do not persist partials.
    sendJson(clientSocket, {
      type: finalize ? "userAnswerFinal" : "userAnswerPartial",
      text: userText,
    });
    // Compatibility alias expected by some clients.
    if (!finalize) {
      sendJson(clientSocket, { type: "userTranscriptLive", text: userText });
    }

    if (!userTranscriptVisible) {
      userTranscriptVisible = true;
      releaseAiHold();
    }
  };

  const beginAwaitingUserTranscript = (): void => {
    awaitingUserTranscript = true;
    userTranscriptVisible = false;
    userTranscriptBuffer = "";
    pendingAiPayloads = [];
    clearHoldTimeout();
    holdTimeoutId = setTimeout(() => {
      holdTimeoutId = null;
      logger.warn(
        `[live-interview] User transcript hold timed out interviewId=${interview.id} — releasing AI output`
      );
      if (sanitizeUserTranscript(userTranscriptBuffer)) {
        markUserTranscriptVisible(true);
      } else {
        userTranscriptVisible = true;
        releaseAiHold();
      }
      awaitingUserTranscript = false;
    }, USER_TRANSCRIPT_HOLD_TIMEOUT_MS);
  };

  const closeBridge = (reason?: string): void => {
    if (closed) return;
    closed = true;
    clearHoldTimeout();
    pendingAiPayloads = [];
    try {
      geminiSession?.close();
    } catch {
      // ignore
    }
    geminiSession = null;
    sendJson(clientSocket, reason ? { type: "sessionClosed", reason } : { type: "sessionClosed" });
    onSessionEnd();
  };

  const enqueuePersist = (task: () => Promise<void>): Promise<void> => {
    turnPersistQueue = turnPersistQueue.then(task).catch((error) => {
      logger.error(`[live-interview] persist task failed interviewId=${interview.id}`, error);
      const message = error instanceof Error ? error.message : "Failed to persist interview turn";
      sendJson(clientSocket, { type: "error", message });
    });
    return turnPersistQueue;
  };

  const handleGeminiMessage = (message: LiveServerMessage): void => {
    const serverContent = message.serverContent;
    if (!serverContent) return;

    if (serverContent.interrupted) {
      pendingAiPayloads = [];
      awaitingUserTranscript = false;
      userTranscriptVisible = false;
      clearHoldTimeout();
      sendJson(clientSocket, { type: "interrupted" });
      return;
    }

    if (serverContent.inputTranscription?.text) {
      userTranscriptBuffer += serverContent.inputTranscription.text;
      markUserTranscriptVisible(false);
    }

    if (serverContent.outputTranscription?.text) {
      aiTranscriptBuffer += serverContent.outputTranscription.text;
      const aiLiveText = aiTranscriptBuffer.trim();
      if (aiLiveText) {
        enqueueOrSendAi({ type: "aiQuestionLive", text: aiLiveText });
      }
    }

    const parts = serverContent.modelTurn?.parts ?? [];
    for (const part of parts) {
      const inlineData = part.inlineData;
      if (!inlineData?.data) continue;

      enqueueOrSendAi({
        type: "audio",
        data: inlineData.data,
        mimeType: inlineData.mimeType ?? "audio/pcm;rate=24000",
      });
    }

    if (serverContent.turnComplete) {
      const aiText = aiTranscriptBuffer.trim();
      const userText = sanitizeUserTranscript(userTranscriptBuffer);

      if (userText) {
        appendTranscript(transcript, "user", userText, onTranscript);
        if (!userTranscriptVisible) {
          userTranscriptVisible = true;
          releaseAiHold();
        }
      } else if (awaitingUserTranscript && !userTranscriptVisible) {
        userTranscriptVisible = true;
        releaseAiHold();
      }

      userTranscriptBuffer = "";
      awaitingUserTranscript = false;
      userTranscriptVisible = false;
      clearHoldTimeout();

      if (aiText) {
        appendTranscript(transcript, "ai", aiText, onTranscript);
        aiTranscriptBuffer = "";
      }

      void enqueuePersist(async () => {
        const skipCandidate = shouldSkipCandidatePersist?.() === true;

        if (userText && !skipCandidate && onFinalizedCandidateAnswer) {
          const saved = await onFinalizedCandidateAnswer(userText);
          if (saved) {
            emitPersistedCandidate(clientSocket, saved);
          } else {
            // Still notify client of finalized STT text without claiming a new write.
            sendJson(clientSocket, { type: "userAnswerFinal", text: userText });
          }
        } else if (userText && skipCandidate) {
          sendJson(clientSocket, { type: "userAnswerFinal", text: userText });
        }

        clearSkipCandidatePersist?.();

        if (aiText && onFinalizedAiQuestion) {
          const saved = await onFinalizedAiQuestion(aiText);
          if (saved) {
            emitPersistedAiQuestion(clientSocket, saved);
          } else {
            sendJson(clientSocket, { type: "aiQuestion", text: aiText });
          }
        } else if (aiText) {
          sendJson(clientSocket, { type: "aiQuestion", text: aiText });
        }

        sendJson(clientSocket, { type: "turnComplete" });
      });
    }
  };

  const systemInstruction = buildLiveInterviewSystemInstruction(interview, resumeMode);

  geminiSession = await getGenAI().live.connect({
    model: appConfig.geminiLiveModel,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: appConfig.geminiVoiceName },
        },
      },
      systemInstruction,
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
    callbacks: {
      onopen: () => {
        logger.info(
          `[live-interview] Gemini session open interviewId=${interview.id} resumeMode=${resumeMode}`
        );
        if (geminiSession) {
          onSessionReady?.(geminiSession);
        }
        sendJson(clientSocket, {
          type: "connected",
          message: "Live interview session ready",
        });
      },
      onmessage: handleGeminiMessage,
      onerror: (event) => {
        const errMessage =
          event instanceof ErrorEvent && event.error instanceof Error
            ? event.error.message
            : "Gemini Live session error";
        logger.error("[live-interview] Gemini error", errMessage);
        sendJson(clientSocket, { type: "error", message: errMessage });
      },
      onclose: () => {
        logger.info(`[live-interview] Gemini session closed interviewId=${interview.id}`);
        closeBridge("gemini_closed");
      },
    },
  });

  try {
    if (resumeMode !== "fresh" && interview.conversation?.length) {
      await geminiSession.sendClientContent({
        turns: interview.conversation.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.message }],
        })),
        // Restore context without asking Gemini to produce a turn.
        turnComplete: false,
      });
    }

    const lastAssistantQuestion = [...(interview.conversation ?? [])]
      .reverse()
      .find((entry) => entry.role === "assistant")?.message;

    const kickoffText = buildResumeKickoffText(resumeMode, lastAssistantQuestion);
    if (kickoffText) {
      await geminiSession.sendClientContent({
        turns: [
          {
            role: "user",
            parts: [{ text: kickoffText }],
          },
        ],
        turnComplete: true,
      });
    }
  } catch (error) {
    logger.warn(`[live-interview] Context/kickoff message failed interviewId=${interview.id}`, error);
  }

  return {
    close: () => closeBridge("client_closed"),
    session: geminiSession,
    beginAwaitingUserTranscript,
  };
};

export const forwardAudioToGemini = (
  session: Session,
  data: string,
  mimeType = "audio/pcm;rate=16000"
): void => {
  session.sendRealtimeInput({
    audio: {
      data,
      mimeType,
    },
  });
};

export const forwardTextToGemini = (session: Session, text: string): void => {
  session.sendClientContent({
    turns: [{ role: "user", parts: [{ text }] }],
    turnComplete: true,
  });
};

export const forwardAudioTurnComplete = (session: Session): void => {
  session.sendRealtimeInput({ audioStreamEnd: true });
};
