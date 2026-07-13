import { Modality, type LiveServerMessage, type Session } from "@google/genai";
import { getGenAI } from "../../config/gemini";
import { appConfig } from "../../config/app.config";
import { logger } from "../../shared/logger";
import { buildLiveInterviewSystemInstruction } from "./live-interview.prompt";
import type { Interview } from "../interview/interview.types";
import type { BrowserWebSocket, LiveTranscriptEntry } from "./live-interview.types";

export interface GeminiLiveBridgeOptions {
  interview: Interview;
  clientSocket: BrowserWebSocket;
  onTranscript: (entry: LiveTranscriptEntry) => void;
  onSessionEnd: () => void;
  onSessionReady?: (session: Session) => void;
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

export const createGeminiLiveBridge = async (
  options: GeminiLiveBridgeOptions
): Promise<GeminiLiveBridge> => {
  const { interview, clientSocket, onTranscript, onSessionEnd, onSessionReady } = options;
  const transcript: LiveTranscriptEntry[] = [];

  let userTranscriptBuffer = "";
  let aiTranscriptBuffer = "";
  let geminiSession: Session | null = null;
  let closed = false;

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

    sendJson(clientSocket, {
      type: finalize ? "userAnswerFinal" : "userAnswerPartial",
      text: userText,
    });

    if (!userTranscriptVisible) {
      userTranscriptVisible = true;
      // User bubble is on screen — now safe to let AI audio/text through.
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
        // No usable STT available — don't block the interview forever.
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
      // Push STT to the client immediately and release any held AI output.
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

      // Always commit user transcript before AI question / turnComplete.
      if (userText) {
        appendTranscript(transcript, "user", userText, onTranscript);
        sendJson(clientSocket, { type: "userAnswerFinal", text: userText });
        if (!userTranscriptVisible) {
          userTranscriptVisible = true;
          releaseAiHold();
        }
      } else if (awaitingUserTranscript && !userTranscriptVisible) {
        // Audio turn completed with no usable STT — release so the interview can continue.
        userTranscriptVisible = true;
        releaseAiHold();
      }

      userTranscriptBuffer = "";
      awaitingUserTranscript = false;
      userTranscriptVisible = false;
      clearHoldTimeout();

      if (aiText) {
        appendTranscript(transcript, "ai", aiText, onTranscript);
        sendJson(clientSocket, { type: "aiQuestion", text: aiText });
        aiTranscriptBuffer = "";
      }

      sendJson(clientSocket, { type: "turnComplete" });
    }
  };

  const systemInstruction = buildLiveInterviewSystemInstruction(interview);

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
        logger.info(`[live-interview] Gemini session open interviewId=${interview.id}`);
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
    await geminiSession.sendClientContent({
      turns: [
        {
          role: "user",
          parts: [
            {
              text: "Hello, I am ready for my interview. Please introduce yourself, explain how this interview will work, and ask your first question.",
            },
          ],
        },
      ],
      turnComplete: true,
    });
  } catch (error) {
    logger.warn(`[live-interview] Kickoff message failed interviewId=${interview.id}`, error);
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
  // Marks end of recorded audio turn so Gemini can respond.
  session.sendRealtimeInput({ audioStreamEnd: true });
};
