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
  USER_RESUME: (uid: string, fileKey: string) => `users/${uid}/resumes/${fileKey}.pdf`,
} as const;

export const FILE_LIMITS = {
  MAX_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
  ALLOWED_MIME_TYPES: ["application/pdf"],
} as const;

export const DEFAULT_QUESTION_COUNT = 10;

export const DIFFICULTY_LEVELS = ["Easy", "Medium", "Hard", "Expert"] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export const INTERVIEW_TYPES = [
  "Technical Interview",
  "Coding Interview",
  "System Design",
  "HR Interview",
  "Behavioral Interview",
] as const;
export type InterviewType = (typeof INTERVIEW_TYPES)[number];

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
