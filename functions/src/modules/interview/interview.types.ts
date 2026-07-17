import { Timestamp } from "firebase-admin/firestore";
import type { DifficultyLevel, InterviewType } from "../../shared/constants";

export enum InterviewStatus {
  DRAFT = "draft",
  STARTED = "started",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export enum InterviewMode {
  PAYLOAD = "payload",
  DOCUMENTS = "documents",
}

export type { DifficultyLevel, InterviewType };

export enum QuestionDifficulty {
  EASY = "easy",
  MEDIUM = "medium",
  HARD = "hard",
  EXPERT = "expert",
}

export const toQuestionDifficulty = (difficultyLevel: DifficultyLevel): QuestionDifficulty =>
  difficultyLevel as QuestionDifficulty;

// ─── Embedded interview document models ───────────────────────────────────────

export interface InterviewQuestion {
  id: string;
  question: string;
  difficulty: QuestionDifficulty;
  answer?: string;
  score?: number;
  feedback?: string;
  answeredAt?: Timestamp;
}

export type InterviewConversationRole = "assistant" | "candidate";

export interface InterviewConversationMessage {
  id: string;
  role: InterviewConversationRole;
  questionId: string;
  message: string;
  createdAt: Timestamp;
}

export interface InterviewReport {
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  summary: string;
  generatedAt: Timestamp;
}

/** Sum of per-question scores (each 0–10) with the interview maximum. */
export interface InterviewTotalScore {
  score: number;
  outOf: number;
}

export interface ResumeAnalysis {
  skills: string[];
  projects: string[];
  experience: string[];
  education: string[];
}

export interface JDAnalysis {
  requiredSkills: string[];
  responsibilities: string[];
  experience: string[];
}

export interface InterviewDocuments {
  resume?: { parsed: ResumeAnalysis };
  jd?: { parsed: JDAnalysis };
}

export interface Interview {
  id: string;
  userId: string;
  mode: InterviewMode;
  domain?: string;
  category?: string;
  specification?: string;
  targetRole?: string;
  experienceLevel?: string;
  difficultyLevel?: DifficultyLevel;
  interviewType?: InterviewType;
  status: InterviewStatus;
  /**
   * Derived from question scores for API responses only — not stored on the interview document.
   */
  totalScore?: InterviewTotalScore;
  questionCount: number;
  durationMinutes?: number;
  questions: InterviewQuestion[];
  conversation?: InterviewConversationMessage[];
  currentQuestionIndex?: number;
  lastSpeaker?: InterviewConversationRole;
  currentTopic?: string;
  currentDifficulty?: QuestionDifficulty;
  currentQuestionId?: string;
  startedAt?: Timestamp;
  remainingSeconds?: number;
  questionStartTime?: Timestamp;
  report?: InterviewReport;
  documents?: InterviewDocuments;
  reportGenerating?: boolean;
  createdAt: Timestamp;
  completedAt?: Timestamp;
  updatedAt: Timestamp;
  version: number;
  isDeleted: boolean;
}

export interface InterviewResumeState {
  status: InterviewStatus;
  conversation: InterviewConversationMessage[];
  currentQuestionIndex: number;
  lastSpeaker?: InterviewConversationRole;
  currentTopic?: string;
  currentDifficulty?: QuestionDifficulty;
  currentQuestionId?: string;
  startedAt?: Timestamp;
  remainingSeconds: number;
  questionStartTime?: Timestamp;
}

export interface LiveTurnCommitResult {
  interview: Interview;
  message: InterviewConversationMessage;
  created: boolean;
}

// ─── Input / Output DTOs ──────────────────────────────────────────────────────

export interface CreateInterviewInput {
  domain: string;
  category: string;
  specification: string;
  targetRole: string;
  experienceLevel: string;
  difficultyLevel: DifficultyLevel;
  interviewType: InterviewType;
  durationMinutes: number;
  questionCount: number;
}

export interface CreateInterviewDocumentsInput {
  resumeBuffer?: Buffer;
  jdBuffer?: Buffer;
}

export interface SubmitAnswerItem {
  questionId: string;
  answer: string;
}

export interface SubmitAnswersInput {
  answers: SubmitAnswerItem[];
}

export interface SubmitAnswerResult {
  questionId: string;
  answer: string;
  score: number;
  feedback: string;
  answeredAt: Timestamp;
}

export interface SubmitAnswersResult {
  results: SubmitAnswerResult[];
  totalScore: InterviewTotalScore;
  answeredCount: number;
}

export interface FinishInterviewResult extends SubmitAnswersResult {
  report: InterviewReport;
}

export interface InterviewSummary {
  id: string;
  userId: string;
  mode: InterviewMode;
  domain?: string;
  category?: string;
  specification?: string;
  targetRole?: string;
  experienceLevel?: string;
  difficultyLevel?: DifficultyLevel;
  interviewType?: InterviewType;
  status: InterviewStatus;
  /** Earned points / maximum (each question worth 0–10). */
  totalScore?: InterviewTotalScore;
  questionCount: number;
  durationMinutes?: number;
  createdAt: Timestamp;
  completedAt?: Timestamp;
  updatedAt: Timestamp;
}

export interface InterviewListResult {
  items: InterviewSummary[];
  hasMore: boolean;
  nextCursor?: string;
}

// ─── AI Raw Outputs ───────────────────────────────────────────────────────────

export interface RawQuestion {
  question: string;
  difficulty: string;
  category: string;
}

export interface RawEvaluation {
  technical: number;
  communication: number;
  completeness: number;
  confidence: number;
  feedback: string;
}

export interface RawBatchEvaluation extends RawEvaluation {
  questionId: string;
}

export interface RawReport {
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  summary?: string;
}
