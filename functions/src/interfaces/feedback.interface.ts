// Mirrors src/app/interfaces/feedback.interface.ts — keep in sync
import type { Timestamp } from 'firebase-admin/firestore';

export type FeedbackCategory = 'ai_quality' | 'bug' | 'feature_request' | 'general';

/** Path: users/{uid}/feedback/{feedbackId} */
export interface FeedbackDoc {
  interviewId?: string;
  rating: number;
  comment?: string;
  category: FeedbackCategory;
  submittedAt: Timestamp;
}
