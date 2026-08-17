// Mirrors src/app/interfaces/user.interface.ts  keep in sync
import type { Timestamp } from 'firebase-admin/firestore';
import type { LearningRoadmapWeek } from './resume.interface';

export type AuthProvider = 'password' | 'google' | 'github';
export type SubscriptionPlan = 'free' | 'pro' | 'team';

/** Nested profile block on users/{uid} */
export interface UserProfile {
  currentRole: string;
  yearsExperience: number;
  targetRole: string;
  targetCompanies: string[];
  location: string;
}

/**
 * Lightweight onboarding snapshot merged onto users/{uid}.onboarding
 * without overwriting user-provided values when already set.
 */
export interface UserOnboardingSnapshot {
  selectedRole?: string;
  experience?: string;
  primarySkills?: string[];
  careerGoal?: string;
  preparationRoadmap?: LearningRoadmapWeek[];
  recommendedInterviewTrack?: string;
  /** Full list from resume onboarding plan (preferred for Career Goals UI). */
  recommendedInterviewTracks?: string[];
  weakSkills?: string[];
  targetCompanies?: string[];
  estimatedPreparationTime?: string;
  roadmapProgress?: number;
  suggestedFirstMockInterview?: string;
  learningPriorities?: string[];
  /** Technologies to learn, inferred from the resume — powers the onboarding "Learning Roadmap" step. */
  recommendedLearningTechnologies?: string[];
  updatedAt?: Timestamp | string;
}

/** Nested gamification block on users/{uid} */
export interface UserGamification {
  level: number;
  levelName: string;
  currentXP: number;
  xpToNextLevel: number;
  streakCount: number;
  /** YYYY-MM-DD (UTC) for streak calculation */
  lastActiveDate: string;
  longestStreak: number;
}

/** Nested readiness block on users/{uid}  server-written only */
export interface UserReadiness {
  score: number;
  deltaWeek: number;
  percentileVsRole: number;
  lastComputedAt: Timestamp;
  // TODO: readinessScore7dAgo not in architecture 1  used by complete-interview deltaWeek calc
  readinessScore7dAgo?: number;
}

/** Nested preferences block on users/{uid} */
export interface UserPreferences {
  dailyReminders: boolean;
  aiVoiceFeedback: boolean;
  focusMode: boolean;
  weeklyProgressEmail: boolean;
  darkMode: boolean;
}

/** Nested subscription block on users/{uid} */
export interface UserSubscription {
  plan: SubscriptionPlan;
  renewsAt?: Timestamp;
}

/**
 * Denormalized counters for achievement rules (interviews_gte / problems_gte).
 * TODO: not in architecture 1  required by on-achievement-check / complete-interview.
 */
export interface UserStats {
  totalInterviews: number;
  problemsSolved: number;
  /** Interviews with overallScore >= 70  used by successful_interviews achievements */
  successfulInterviews?: number;
  /** Overall score of the most recently completed interview, used by score_improvement achievements. */
  lastOverallScore?: number;
  /** Count of distinct learning roadmap weeks passed, used by roadmap_weeks_completed achievements. */
  roadmapWeeksCompleted?: number;
}

/**
 * Per-skill doc under users/{uid}/skills/{skillId}.
 * TODO: skills subcollection shape not fully specified in architecture  inferred from Phase 2.
 */
export interface SkillDoc {
  score: number;
  deltaThisWeek: number;
  updatedAt: Timestamp;
}

export type SkillId =
  | 'technical'
  | 'communication'
  | 'confidence'
  | 'problemSolving'
  | 'coding'
  | 'behavior';

/**
 * Daily goal under users/{uid}/goals/{goalId}.
 * TODO: goals collection is not in architecture.md  required by complete-interview step 8.
 */
export interface GoalDoc {
  date: string;
  status: 'pending' | 'done';
  /** Implied activity type used to match InterviewMode */
  impliedType?: string;
  xpReward: number;
  title?: string;
}

/** Path: users/{uid} */
export interface UserDoc {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  provider: AuthProvider;
  createdAt: Timestamp;
  lastLoginAt: Timestamp;
  profile: UserProfile;
  gamification: UserGamification;
  readiness: UserReadiness;
  preferences: UserPreferences;
  subscription: UserSubscription;
  // TODO: stats not in architecture 1  denormalized counters for achievement rules
  stats?: UserStats;
  /** Populated from onboarding analysis (resume or Q&A) — merge-only. */
  onboarding?: UserOnboardingSnapshot;
  /**
   * Set after a successful resume analyze so clients can skip re-analysis
   * during onboarding (users/{uid}.resumeAnalysisCompleted).
   * Prefer `onboardingAnalysisCompleted` for new code.
   */
  resumeAnalysisCompleted?: boolean;
  /**
   * Set after onboarding analysis is generated (resume upload or Q&A).
   * Path: users/{uid}/onboarding/analysis
   */
  onboardingAnalysisCompleted?: boolean;
  isCoder?: boolean;
  /**
   * Average of each skill across the candidate's last 5 completed interviews,
   * plus totalScore (average of all 6 skills). Recomputed after every
   * interview completes + its report generates.
   */
  skillSignals?: Record<SkillId, number> & { totalScore: number };
  /** Flat readiness used by dashboard / career progress UI */
  readinessScore?: number;
  /** Percentile vs peers ? dashboard ?Ahead of X% of ?? */
  peerComparisonPercent?: number;
  peerRole?: string;
  updatedAt?: Timestamp;
}
