import { Timestamp } from "firebase-admin/firestore";

export enum InterviewStatus {
  DRAFT = "draft",
  PROCESSING = "processing",
  READY = "ready",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  FAILED = "failed",
}

export enum InterviewType {
  TECHNICAL = "technical",
  BEHAVIORAL = "behavioral",
  MIXED = "mixed",
}

export enum QuestionDifficulty {
  EASY = "easy",
  MEDIUM = "medium",
  HARD = "hard",
}

// ─── Domain Models ────────────────────────────────────────────────────────────

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

export interface Interview {
  id: string;
  userId: string;
  role: string;
  experience: string;
  type: InterviewType;
  status: InterviewStatus;
  resumeURL?: string;
  jdURL?: string;
  resumeAnalysis?: ResumeAnalysis;
  jdAnalysis?: JDAnalysis;
  totalQuestions: number;
  answeredQuestions: number;
  /** Aggregate score out of 100 (10 per question; 0 if not attempted). */
  overallPerformance?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Question {
  id: string;
  interviewId: string;
  userId: string;
  question: string;
  difficulty: QuestionDifficulty;
  category: string;
  order: number;
  createdAt: Timestamp;
}

export interface Answer {
  id: string;
  interviewId: string;
  questionId: string;
  userId: string;
  answer: string;
  submittedAt: Timestamp;
}

export interface Evaluation {
  id: string;
  interviewId: string;
  questionId: string;
  answerId: string;
  userId: string;
  technical: number;
  communication: number;
  completeness: number;
  confidence: number;
  feedback: string;
  createdAt: Timestamp;
}

export interface Report {
  id: string;
  interviewId: string;
  userId: string;
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  createdAt: Timestamp;
}

// ─── Input / Output DTOs ──────────────────────────────────────────────────────

export interface CreateInterviewInput {
  role: string;
  experience: string;
  type: InterviewType;
}

export interface SubmitAnswerInput {
  questionId: string;
  answer: string;
}

export interface SubmitAnswerResult {
  answer: Answer;
  evaluation: Evaluation;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface ListInterviewsQuery {
  page: number;
  limit: number;
  status?: InterviewStatus;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
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

export interface RawReport {
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}
