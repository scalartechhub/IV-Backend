export const COLLECTIONS = {
  USERS: "users",
  INTERVIEWS: "interviews",
  NOTIFICATIONS: "notifications",
} as const;

/** Chat module Firestore collection names */
export const CHAT_COLLECTIONS = {
  CONVERSATIONS: "chatConversations",
  MESSAGES: "messages",
} as const;

export const STORAGE_PATHS = {
  RESUME: (interviewId: string) => `interviews/${interviewId}/resume.pdf`,
  JD: (interviewId: string) => `interviews/${interviewId}/jd.pdf`,
  USER_RESUME: (uid: string, fileKey: string) => `users/${uid}/resumes/${fileKey}.pdf`,
} as const;

export const FILE_LIMITS = {
  MAX_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
  ALLOWED_MIME_TYPES: ["application/pdf"],
} as const;

export const DEFAULT_QUESTION_COUNT = 10;

export const DIFFICULTY_LEVELS = ["easy", "medium", "hard", "expert"] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export const INTERVIEW_TYPES = [
  "technicalInterview",
  "codingInterview",
  "systemDesign",
  "hrInterview",
  "behavioralInterview",
] as const;
export type InterviewType = (typeof INTERVIEW_TYPES)[number];

export const RATE_LIMIT = {
  WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  MAX_REQUESTS: 100,
  AI_MAX_REQUESTS: 20,
  AI_WINDOW_MS: 60 * 1000, // 1 minute
} as const;

export const INTERVIEW_DOCUMENT_VERSION = 2;
