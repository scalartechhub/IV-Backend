export const COLLECTIONS = {
  USERS: "users",
  INTERVIEWS: "interviews",
} as const;

/** Legacy collection names — used only by MigrationService */
export const LEGACY_COLLECTIONS = {
  QUESTIONS: "questions",
  ANSWERS: "answers",
  EVALUATIONS: "evaluations",
  REPORTS: "reports",
  CHAT_CONVERSATIONS: "chatConversations",
  CHAT_MESSAGES: "messages",
} as const;

export const STORAGE_PATHS = {
  RESUME: (interviewId: string) => `interviews/${interviewId}/resume.pdf`,
  JD: (interviewId: string) => `interviews/${interviewId}/jd.pdf`,
} as const;

export const FILE_LIMITS = {
  MAX_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
  ALLOWED_MIME_TYPES: ["application/pdf"],
} as const;

export const QUESTION_DISTRIBUTION = {
  EASY: 3,
  MEDIUM: 4,
  HARD: 3,
  TOTAL: 10,
} as const;

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 50,
} as const;

export const RATE_LIMIT = {
  WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  MAX_REQUESTS: 100,
  AI_MAX_REQUESTS: 20,
  AI_WINDOW_MS: 60 * 1000, // 1 minute
} as const;

export const INTERVIEW_DOCUMENT_VERSION = 2;
