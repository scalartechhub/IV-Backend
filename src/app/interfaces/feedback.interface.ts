import type { Timestamp } from 'firebase/firestore';

export type FeedbackCategory = 'ai_quality' | 'bug' | 'feature_request' | 'general';

/** Path: users/{uid}/feedback/{feedbackId} */
export interface FeedbackDoc {
  interviewId?: string;
  rating: number;
  comment?: string;
  category: FeedbackCategory;
  submittedAt: Timestamp;
}
