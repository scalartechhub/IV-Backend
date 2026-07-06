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

export interface InterviewReport {
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  summary: string;
  generatedAt: Timestamp;
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
  technology?: string;
  experienceLevel?: string;
  difficultyLevel?: DifficultyLevel;
  interviewType?: InterviewType;
  status: InterviewStatus;
  overallScore?: number;
  questionCount: number;
  durationMinutes?: number;
  questions: InterviewQuestion[];
  report?: InterviewReport;
  documents?: InterviewDocuments;
  reportGenerating?: boolean;
  createdAt: Timestamp;
  completedAt?: Timestamp;
  updatedAt: Timestamp;
  version: number;
  isDeleted: boolean;
}

// ─── Input / Output DTOs ──────────────────────────────────────────────────────

export interface CreateInterviewInput {
  technology: string;
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
  overallScore: number;
  answeredCount: number;
}

export interface FinishInterviewResult extends SubmitAnswersResult {
  report: InterviewReport;
}

export interface InterviewSummary {
  id: string;
  userId: string;
  mode: InterviewMode;
  technology?: string;
  experienceLevel?: string;
  difficultyLevel?: DifficultyLevel;
  interviewType?: InterviewType;
  status: InterviewStatus;
  overallScore?: number;
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
