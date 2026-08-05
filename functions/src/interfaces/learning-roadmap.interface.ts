// Path: users/{uid}/learningRoadmap/current (+ subcollection topicNotes/{topicId})
import type { Timestamp } from 'firebase-admin/firestore';

/** A single study topic assigned to a day within a week. */
export interface LearningRoadmapTopic {
  id: string;
  name: string;
  completed: boolean;
}

/**
 * One day of the roadmap — a small set of topics, unlocked once the previous
 * day's knowledge check is passed AND at least one calendar day has elapsed
 * since that pass (`passedAt`). `unlocked` is always recomputed at read time
 * from the previous day's `passed`/`passedAt` — it is not trusted as stored.
 */
export interface LearningRoadmapDay {
  day: number;
  topics: LearningRoadmapTopic[];
  unlocked: boolean;
  completed: boolean;
  interviewId?: string;
  score?: number;
  passed?: boolean;
  /** Set when `passed` becomes true; cleared (null) on a failed attempt. */
  passedAt?: Timestamp | null;
}

/** Path: users/{uid}/learningRoadmap/current */
export interface LearningRoadmapDoc {
  technology: string;
  weekNumber: number;
  days: LearningRoadmapDay[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** One structured section of AI-generated topic notes. */
export interface LearningTopicNotesSection {
  heading: string;
  content: string;
  bullets?: string[];
}

/** Path: users/{uid}/learningRoadmap/current/topicNotes/{topicId} */
export interface LearningTopicNotesDoc {
  topicId: string;
  topicName: string;
  technology: string;
  summary: string;
  sections: LearningTopicNotesSection[];
  keyTakeaways: string[];
  createdAt: Timestamp;
}
