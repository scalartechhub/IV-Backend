import type { Timestamp } from 'firebase/firestore';

/**
 * Notification types from architecture §8.
 * TODO: 'level_up' is required by complete-interview but not listed in architecture §8.
 */
export type NotificationType =
  | 'reminder'
  | 'achievement_unlocked'
  | 'streak_risk'
  | 'report_ready'
  | 'job_match'
  | 'system'
  | 'level_up';

/** Path: users/{uid}/notifications/{notificationId} */
export interface NotificationDoc {
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  createdAt: Timestamp;
  actionUrl?: string;
  relatedId?: string;
}
