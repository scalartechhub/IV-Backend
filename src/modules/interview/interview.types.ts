import { Timestamp } from "firebase-admin/firestore";

export enum InterviewStatus {
  DRAFT = "draft",
  STARTED = "started",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export enum InterviewType {
  TECHNICAL = "technical",
  HR = "hr",
  MIXED = "mixed",
}

export enum QuestionDifficulty {
  EASY = "easy",
  MEDIUM = "medium",
  HARD = "hard",
}

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

/** Optional AI context persisted during resume/JD upload (not required for list views). */
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
  technology: string;
  experienceLevel: string;
  interviewType: InterviewType;
  status: InterviewStatus;
  overallScore?: number;
  questionCount: number;
  durationMinutes?: number;
  questions: InterviewQuestion[];
  report?: InterviewReport;
  /** Internal flag while report AI generation is in progress */
  reportGenerating?: boolean;
  resumeUrl?: string;
  jdUrl?: string;
  resumeAnalysis?: ResumeAnalysis;
  jdAnalysis?: JDAnalysis;
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
  interviewType: InterviewType;
  durationMinutes: number;
  questionCount: number;
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
