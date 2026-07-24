import type { Timestamp } from 'firebase/firestore';

export type AchievementCategory =
  | 'streak'
  | 'interview'
  | 'coding'
  | 'communication'
  | 'milestone';

export type AchievementRuleType =
  | 'streak_gte'
  | 'interviews_gte'
  | 'score_gte'
  | 'problems_gte';

export interface AchievementRule {
  type: AchievementRuleType;
  value: number;
}

/** Path: achievementsCatalog/{achievementId} */
export interface AchievementCatalogDoc {
  name: string;
  description: string;
  icon: string;
  category: AchievementCategory;
  rule: AchievementRule;
  totalCount: number;
}

/** Path: users/{uid}/achievements/{achievementId} */
export interface UserAchievementDoc {
  unlockedAt: Timestamp;
  seen: boolean;
  progressSnapshot?: number;
}
