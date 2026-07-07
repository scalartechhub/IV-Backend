import type WebSocket from "ws";

export type LiveClientMessageType = "audio" | "text" | "end";

export interface LiveClientAudioMessage {
  type: "audio";
  data: string;
  mimeType?: string;
}

export interface LiveClientTextMessage {
  type: "text";
  text: string;
}

export interface LiveClientEndMessage {
  type: "end";
}

export type LiveClientMessage =
  | LiveClientAudioMessage
  | LiveClientTextMessage
  | LiveClientEndMessage;

export type LiveServerMessageType =
  | "connected"
  | "audio"
  | "userTranscriptLive"
  | "aiQuestion"
  | "userAnswerFinal"
  | "turnComplete"
  | "interrupted"
  | "ended"
  | "sessionClosed"
  | "error";

export interface LiveTranscriptEntry {
  role: "user" | "ai";
  text: string;
  timestamp: number;
}

export interface LiveInterviewSessionState {
  interviewId: string;
  userId: string;
  transcript: LiveTranscriptEntry[];
  startedAt: number;
  endedAt?: number;
}

export type BrowserWebSocket = WebSocket;
