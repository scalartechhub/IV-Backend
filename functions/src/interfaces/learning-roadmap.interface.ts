// Path: users/{uid}/learningRoadmap/current
// Subcollections: subtopicNotes/{subtopicId}, quizzes/{quizId}
import type { Timestamp } from 'firebase-admin/firestore';

export interface RoadmapSubtopic {
  id: string;
  name: string;
  isComplete: boolean;
}

export interface RoadmapQuiz {
  id: string;
  title: string;
  questionCount: number;
  isComplete: boolean;
  score?: number;
}

export interface RoadmapTopic {
  id: string;
  name: string;
  description: string;
  subtopics: RoadmapSubtopic[];
  topicsCount: number;
  lessonsCount: number;
  quizzes: RoadmapQuiz[];
  isComplete: boolean;
  completionPercent: number;
}

export interface RoadmapWeekInterview {
  interviewId?: string;
  score?: number;
  passed?: boolean;
  passedAt?: Timestamp | null;
}

export interface RoadmapWeek {
  weekNumber: number;
  title: string;
  unlocked: boolean;
  isComplete: boolean;
  interviewUnlocked: boolean;
  interview?: RoadmapWeekInterview;
  topics: RoadmapTopic[];
}

/** Path: users/{uid}/learningRoadmap/current */
export interface LearningRoadmapDoc {
  technology: string;
  weeks: RoadmapWeek[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** One structured section of AI-generated subtopic notes. */
export interface LearningTopicNotesSection {
  heading: string;
  content: string;
  bullets?: string[];
}

/**
 * Path: users/{uid}/learningRoadmap/current/subtopicNotes/{subtopicId}
 * Detailed AI-generated notes for a single subtopic, generated on demand the first time the
 * user opens that subtopic (one Gemini call per subtopic, not batched per topic).
 */
export interface SubtopicNotesDoc {
  subtopicId: string;
  subtopicName: string;
  topicId: string;
  topicName: string;
  technology: string;
  summary: string;
  sections: LearningTopicNotesSection[];
  keyTakeaways: string[];
  createdAt: Timestamp;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: string;
}

/** Path: users/{uid}/learningRoadmap/current/quizzes/{quizId} */
export interface QuizDoc {
  quizId: string;
  topicId: string;
  topicName: string;
  technology: string;
  questions: QuizQuestion[];
  createdAt: Timestamp;
}
