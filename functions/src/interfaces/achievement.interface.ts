// Mirrors frontend achievement.interface.ts — keep in sync
import type { Timestamp } from 'firebase-admin/firestore';

export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';

export type AchievementMetric =
  | 'interviews_completed'
  | 'successful_interviews'
  | 'streak_days'
  | 'xp_total'
  | 'highest_score'
  | 'delivery_score'
  | 'content_score'
  | 'communication_score'
  | 'confidence_score'
  | 'problem_solving_score'
  | 'technical_score'
  | 'behavior_score'
  | 'domain_sessions'
  | 'score_improvement';

/** Path: achievements/{achievementId} — master catalog (seeded, read-only for clients) */
export interface AchievementDoc {
  name: string;
  description: string;
  category: string;
  rarity: AchievementRarity;
  points: number;
  iconUrl: string;
  iconKey: string;
  criteria: string;
  targetValue: number;
  order: number;
  isActive: boolean;
  metric: AchievementMetric;
  /** Optional domain filter for domain_sessions metric */
  track?: string;
  createdAt?: Timestamp;
}

/** Path: users/{uid}/achievements/{achievementId} */
export interface UserAchievementDoc {
  achievementId: string;
  unlocked: boolean;
  unlockedAt: Timestamp | null;
  currentValue: number;
  updatedAt: Timestamp;
}

/** @deprecated Legacy catalog shape — kept for type compat during migration */
export type AchievementCatalogDoc = AchievementDoc;
