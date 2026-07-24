import type { Timestamp } from 'firebase/firestore';

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

/** Nested readiness block on users/{uid} — server-written only */
export interface UserReadiness {
  score: number;
  deltaWeek: number;
  percentileVsRole: number;
  lastComputedAt: Timestamp;
  // TODO: readinessScore7dAgo not in architecture §1 — used by complete-interview deltaWeek calc
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
 * TODO: not in architecture §1 — required by on-achievement-check / complete-interview.
 */
export interface UserStats {
  totalInterviews: number;
  problemsSolved: number;
}

/**
 * Per-skill doc under users/{uid}/skills/{skillId}.
 * TODO: skills subcollection shape not fully specified in architecture — inferred from Phase 2.
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
 * TODO: goals collection is not in architecture.md — required by complete-interview step 8.
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
  // TODO: stats not in architecture §1 — denormalized counters for achievement rules
  stats?: UserStats;
}
