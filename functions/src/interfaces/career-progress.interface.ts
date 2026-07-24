// Mirrors src/app/interfaces/career-progress.interface.ts — keep in sync
import type { Timestamp } from 'firebase-admin/firestore';

/** Nested salary insights on users/{uid}/careerProgress/current */
export interface SalaryInsights {
  currency: string;
  expectedRangeMin: number;
  expectedRangeMax: number;
  positionInRange: number;
  mostRequestedSkill: string;
  fastestImprovingSkill: { name: string; deltaPercent: number };
}

/** Nested peer benchmark on users/{uid}/careerProgress/current */
export interface PeerBenchmark {
  cohortLabel: string;
  cohortSize: number;
  scores: Record<string, { you: number; peerAvg: number }>;
}

/** Nested milestone on users/{uid}/careerProgress/current */
export interface Milestone {
  id: string;
  title: string;
  targetValue: number;
  currentValue: number;
  unlocksLevel: string;
}

/** Path: users/{uid}/careerProgress/current */
export interface CareerProgressDoc {
  salaryInsights: SalaryInsights;
  peerBenchmark: PeerBenchmark;
  milestones: Milestone[];
  lastComputedAt: Timestamp;
}
