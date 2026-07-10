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
): Promise<{ close: () => void; session: Session | null }> => {
  const { interview, clientSocket, onTranscript, onSessionEnd, onSessionReady } = options;
  const transcript: LiveTranscriptEntry[] = [];

  let userTranscriptBuffer = "";
  let aiTranscriptBuffer = "";
  let geminiSession: Session | null = null;
  let closed = false;

  const closeBridge = (reason?: string): void => {
    if (closed) return;
    closed = true;
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
      sendJson(clientSocket, { type: "interrupted" });
      return;
    }

    if (serverContent.inputTranscription?.text) {
      userTranscriptBuffer += serverContent.inputTranscription.text;
      sendJson(clientSocket, {
        type: "userTranscriptLive",
        text: userTranscriptBuffer.trim(),
      });
    }

    if (serverContent.outputTranscription?.text) {
      aiTranscriptBuffer += serverContent.outputTranscription.text;
      const aiLiveText = aiTranscriptBuffer.trim();
      if (aiLiveText) {
        sendJson(clientSocket, { type: "aiQuestionLive", text: aiLiveText });
      }
    }

    const parts = serverContent.modelTurn?.parts ?? [];
    for (const part of parts) {
      const inlineData = part.inlineData;
      if (!inlineData?.data) continue;

      sendJson(clientSocket, {
        type: "audio",
        data: inlineData.data,
        mimeType: inlineData.mimeType ?? "audio/pcm;rate=24000",
      });
    }

    if (serverContent.turnComplete) {
      const aiText = aiTranscriptBuffer.trim();
      const userText = userTranscriptBuffer.trim();

      if (aiText) {
        appendTranscript(transcript, "ai", aiText, onTranscript);
        sendJson(clientSocket, { type: "aiQuestion", text: aiText });
        aiTranscriptBuffer = "";
      }

      if (userText) {
        appendTranscript(transcript, "user", userText, onTranscript);
        sendJson(clientSocket, { type: "userAnswerFinal", text: userText });
        userTranscriptBuffer = "";
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
          event instanceof Error
            ? event.message
            : typeof event === "object" &&
                event !== null &&
                "message" in event &&
                typeof (event as { message?: unknown }).message === "string"
              ? (event as { message: string }).message
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
