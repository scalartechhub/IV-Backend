import type { Timestamp } from 'firebase/firestore';

export type RoadmapGeneratedFrom = 'interview_performance' | 'manual_regenerate';
export type RoadmapActivityType = 'video' | 'reading' | 'practice' | 'project' | 'interview';
export type RoadmapActivityStatus = 'pending' | 'in_progress' | 'done';

/** Nested activity inside a roadmap week */
export interface RoadmapActivity {
  id: string;
  title: string;
  type: RoadmapActivityType;
  estMinutes: number;
  status: RoadmapActivityStatus;
  linkedInterviewId?: string;
}

/** Nested week inside a roadmap */
export interface RoadmapWeek {
  weekNumber: number;
  theme: string;
  unlocked: boolean;
  percentComplete: number;
  activities: RoadmapActivity[];
}

/** Path: users/{uid}/roadmap/{roadmapId} */
export interface RoadmapDoc {
  title: string;
  targetRole: string;
  generatedAt: Timestamp;
  generatedFrom: RoadmapGeneratedFrom;
  isActive: boolean;
  weeks: RoadmapWeek[];
}
