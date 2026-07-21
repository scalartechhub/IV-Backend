import type WebSocket from "ws";
import type {
  InterviewConversationMessage,
  InterviewConversationRole,
  InterviewResumeState,
  QuestionDifficulty,
} from "../interview/interview.types";
import type { Timestamp } from "firebase-admin/firestore";

export type LiveClientMessageType = "audio" | "text" | "audioComplete" | "end";

export interface LiveClientAudioMessage {
  type: "audio";
  data: string;
  mimeType?: string;
  language?: string;
}

export interface LiveClientTextMessage {
  type: "text";
  text: string;
  language?: string;
}

export interface LiveClientAudioCompleteMessage {
  type: "audioComplete";
  language?: string;
}

export interface LiveClientEndMessage {
  type: "end";
}

export type LiveClientMessage =
  | LiveClientAudioMessage
  | LiveClientTextMessage
  | LiveClientAudioCompleteMessage
  | LiveClientEndMessage;

export type LiveServerMessageType =
  | "connected"
  | "audio"
  | "userTranscriptLive"
  | "userAnswerPartial"
  | "aiQuestionLive"
  | "aiQuestion"
  | "userAnswerFinal"
  | "turnComplete"
  | "interrupted"
  | "ended"
  | "sessionClosed"
  | "error"
  | "interview_started"
  | "ai_question"
  | "candidate_answer_saved"
  | "conversation_updated"
  | "interview_resumed"
  | "interview_completed"
  | "timer_tick";

export interface LiveTranscriptEntry {
  role: "user" | "ai";
  text: string;
  timestamp: number;
}

export type LiveResumeMode = "fresh" | "await_candidate" | "generate_next";

export interface LiveInterviewSessionState {
  interviewId: string;
  userId: string;
  transcript: LiveTranscriptEntry[];
  startedAt: number;
  endedAt?: number;
}

export type BrowserWebSocket = WebSocket;

export interface PersistedTurnPayload {
  message: InterviewConversationMessage;
  conversation: InterviewConversationMessage[];
  lastSpeaker: InterviewConversationRole | null;
  currentQuestionId?: string;
  currentQuestionIndex?: number;
  remainingSeconds?: number;
  currentTopic?: string;
  currentDifficulty?: QuestionDifficulty;
  questionStartTime?: Timestamp;
  created: boolean;
}

export type { InterviewConversationMessage, InterviewConversationRole, InterviewResumeState };
