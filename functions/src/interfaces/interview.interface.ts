// Mirrors src/app/interfaces/interview.interface.ts � keep in sync
import type { Timestamp } from 'firebase-admin/firestore';

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
/** Architecture �Review gap � add endReason for natural finish vs dropped connection */
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
  // TODO: architecture �Review � reverse link from roadmap activity
  sourceRoadmapActivityId?: string;
  /** Practice template that spawned this interview */
  sourceTemplateId?: string;
  /** Company prep card that spawned this interview */
  sourceCompanyId?: string;
}

/** Nested Gemini Live session metadata on interviews/{interviewId} */
export interface InterviewAiSession {
  geminiSessionId: string;
  modelVersion: string;
  tokenUsage: { input: number; output: number; total: number };
  estimatedCostUsd: number;
  connectionQuality: ConnectionQuality;
  reconnectCount: number;
  /** Cached system prompt built at /start — reused to mint Live ephemeral tokens. */
  systemInstructions?: string;
}

/** Nested device/environment block on interviews/{interviewId} */
export interface InterviewEnvironment {
  audioEnabled: boolean;
  cameraEnabled: boolean;
  browser: string;
  os: string;
  internetQualityMbps: number;
}

/** Nested scoring results on interviews/{interviewId} � server-written only */
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
  /** Per-topic strong/weak classification extracted from this interview's transcript. */
  topicOutcomes?: TopicOutcome[];
}

export type TopicStatus = 'strong' | 'weak';

/** Per-topic classification returned by scoring for a single interview. */
export interface TopicOutcome {
  topic: string;
  status: TopicStatus;
}

/**
 * Path: users/{uid}/interviewTopics/profile — cross-interview topic mastery tracking.
 * strong/weak are plain normalized topic-name arrays (no per-topic metadata).
 */
export interface TopicProfileDoc {
  strong: string[];
  weak: string[];
}

export interface InterviewCodingData {
  problemIds: string[];
  submissionIds: string[];
  passRate: number;
}

export type InterviewConversationRole = 'assistant' | 'candidate';

/** Persisted mid-call transcript turns on interviews/{interviewId} */
export interface InterviewConversationMessage {
  id: string;
  role: InterviewConversationRole;
  text: string;
  createdAt: Timestamp;
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
  // TODO: endReason listed as missing in architecture �Review � required by complete-interview
  endReason?: EndReason;
  aiSession: InterviewAiSession;
  environment: InterviewEnvironment;
  results?: InterviewResults;
  xpEarned: number;
  reportId?: string;
  codingData?: InterviewCodingData;
  /** Mid-call transcript for refresh recovery and scoring fallback */
  conversation?: InterviewConversationMessage[];
  lastSpeaker?: InterviewConversationRole;
  /** Snapshot of time left; derived from startedAt + config.durationMinutes when live */
  remainingSeconds?: number;
  /** Elapsed live seconds (durationMinutes * 60 - remainingSeconds), persisted for refresh */
  liveElapsedSec?: number;
  // TODO: transcriptArchived not in architecture �3 � required by archive-old-transcripts
  transcriptArchived?: boolean;
  /** Soft-delete flag � heatmap / list queries filter isDeleted == false */
  isDeleted?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type DominantEmotion =
  | 'confident'
  | 'neutral'
  | 'nervous'
  | 'confused'
  | 'calm'
  | 'fear'
  | 'angry';

export interface FaceEmotionScores {
  confident?: number;
  calm?: number;
  neutral?: number;
  nervous?: number;
  confused?: number;
  fear?: number;
  angry?: number;
}

/** interviews/{interviewId}/faceSignals/{signalId} — emotion aggregates only */
export interface FaceSignalDoc {
  dominantEmotion: DominantEmotion;
  emotionScores: FaceEmotionScores;
  capturedAt?: Timestamp;
}
