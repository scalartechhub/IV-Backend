import type { Timestamp } from 'firebase/firestore';

export type InterviewMode = 'conversational' | 'coding' | 'behavioral' | 'system_design';
export type InterviewStatus =
  | 'created'
  | 'device_check'
  | 'in_progress'
  | 'completed'
  | 'abandoned'
  | 'expired';
export type InterviewDifficulty = 'easy' | 'medium' | 'hard';
export type ConnectionQuality = 'good' | 'fair' | 'poor';
/** Architecture §Review gap — add endReason for natural finish vs dropped connection */
export type EndReason =
  | 'time_expired'
  | 'user_ended'
  | 'connection_lost'
  | 'max_questions_signal';

/** Nested config block on interviews/{interviewId} */
export interface InterviewConfig {
  topic?: string;
  company?: string;
  skills: string[];
  technologies: string[];
  difficulty: InterviewDifficulty;
  durationMinutes: number;
  resumeVersionUsed?: string;
  currentRole: string;
  targetRole: string;
  // TODO: architecture §Review — reverse link from roadmap activity
  sourceRoadmapActivityId?: string;
}

/** Nested Gemini Live session metadata on interviews/{interviewId} */
export interface InterviewAiSession {
  geminiSessionId: string;
  modelVersion: string;
  tokenUsage: { input: number; output: number; total: number };
  estimatedCostUsd: number;
  connectionQuality: ConnectionQuality;
  reconnectCount: number;
}

/** Nested device/environment block on interviews/{interviewId} */
export interface InterviewEnvironment {
  audioEnabled: boolean;
  cameraEnabled: boolean;
  browser: string;
  os: string;
  internetQualityMbps: number;
}

/** Nested scoring results on interviews/{interviewId} — server-written only */
export interface InterviewResults {
  overallScore: number;
  technicalScore: number;
  communicationScore: number;
  confidenceScore: number;
  problemSolvingScore: number;
  codingScore?: number;
  behaviorScore?: number;
  skillDeltas: Record<string, number>;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  nextLearningPathId?: string;
}

export interface InterviewCodingData {
  problemIds: string[];
  submissionIds: string[];
  passRate: number;
}

/** Path: interviews/{interviewId} */
export interface InterviewDoc {
  userId: string;
  mode: InterviewMode;
  status: InterviewStatus;
  config: InterviewConfig;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  durationSec?: number;
  autoEnded: boolean;
  // TODO: endReason listed as missing in architecture §Review — required by complete-interview
  endReason?: EndReason;
  aiSession: InterviewAiSession;
  environment: InterviewEnvironment;
  results?: InterviewResults;
  xpEarned: number;
  reportId?: string;
  codingData?: InterviewCodingData;
  // TODO: transcriptArchived not in architecture §3 — required by archive-old-transcripts
  transcriptArchived?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
