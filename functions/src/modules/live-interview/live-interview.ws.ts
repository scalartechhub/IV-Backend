import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { IncomingMessage, Server } from "http";
import { URL } from "url";
import type { Session } from "@google/genai";
import { auth } from "../../config/firebase";
import { logger } from "../../shared/logger";
import { isCloudRuntime } from "../../shared/runtime";
import * as repo from "../interview/interview.repository";
import { InterviewStatus } from "../interview/interview.types";
import {
  createGeminiLiveBridge,
  forwardAudioToGemini,
  forwardTextToGemini,
} from "./live-interview.gemini-bridge";
import type { LiveClientMessage, LiveTranscriptEntry } from "./live-interview.types";

const LIVE_WS_PATH = "/ws/interview";

interface ActiveLiveSession {
  interviewId: string;
  userId: string;
  transcript: LiveTranscriptEntry[];
  geminiSession: Session | null;
  closeBridge: () => void;
}

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

    try {
      const userId = await verifyTokenFromRequest(req);
      const interviewId = getInterviewIdFromRequest(req);
      const interview = await repo.requireOwnedInterview(interviewId, userId);

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

      if (interview.status === InterviewStatus.DRAFT) {
        await repo.updateInterview(interviewId, { status: InterviewStatus.STARTED });
      }

      const transcript: LiveTranscriptEntry[] = [];
      const sessionState: ActiveLiveSession = {
        interviewId,
        userId,
        transcript,
        geminiSession: null,
        closeBridge: () => undefined,
      };

      const bridge = await createGeminiLiveBridge({
        interview,
        clientSocket,
        onTranscript: (entry) => transcript.push(entry),
        onSessionEnd: () => activeSessions.delete(clientSocket),
        onSessionReady: (geminiSession) => {
          sessionState.geminiSession = geminiSession;
        },
      });

      sessionState.closeBridge = bridge.close;
      sessionState.geminiSession = bridge.session;
      activeSessions.set(clientSocket, sessionState);
      bridgeClose = bridge.close;

      clientSocket.on("message", (raw) => {
        const message = parseClientMessage(raw);
        if (!message) return;

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
          forwardTextToGemini(geminiSession, message.text.trim());
          return;
        }

        if (message.type === "end") {
          sendJson(clientSocket, { type: "ended" });
          bridge.close();
          clientSocket.close();
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start live session";
      logger.error("[live-interview] connection failed", error);
      sendJson(clientSocket, { type: "error", message });
      clientSocket.close();
      return;
    }

    clientSocket.on("close", () => {
      bridgeClose?.();
      activeSessions.delete(clientSocket);
    });

    clientSocket.on("error", (error) => {
      logger.error("[live-interview] client socket error", error);
      bridgeClose?.();
      activeSessions.delete(clientSocket);
    });
  });

  logger.info(`[live-interview] WebSocket server ready at ${LIVE_WS_PATH}`);
};

export const getLiveWsPath = (): string => LIVE_WS_PATH;
