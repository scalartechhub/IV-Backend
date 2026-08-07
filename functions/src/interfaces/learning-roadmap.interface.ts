// Path: users/{uid}/learningRoadmap/current
// Subcollections: topicNotes/{topicId}, quizzes/{quizId}
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

/** Detailed AI-generated notes for a single subtopic, part of a topic-level batch. */
export interface SubtopicNotes {
  subtopicId: string;
  subtopicName: string;
  summary: string;
  sections: LearningTopicNotesSection[];
  keyTakeaways: string[];
}

/**
 * Path: users/{uid}/learningRoadmap/current/topicNotes/{topicId}
 * Notes for every subtopic under one main topic, generated together in a single AI call
 * the first time the user opens that topic.
 */
export interface LearningTopicNotesDoc {
  topicId: string;
  topicName: string;
  technology: string;
  subtopics: SubtopicNotes[];
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
