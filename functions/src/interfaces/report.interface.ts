// Mirrors src/app/interfaces/report.interface.ts — keep in sync
import type { Timestamp } from 'firebase-admin/firestore';

/** Path: users/{uid}/reports/{reportId} */
export interface ReportDoc {
  interviewId: string;
  generatedAt: Timestamp;
  summary: string;
  charts: {
    skillBreakdown: Record<string, number>;
    timeline: Array<{ label: string; score: number }>;
  };
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  pdfStoragePath?: string;
  comparedToPreviousReportId?: string;
}

/** Path: users/{uid}/weeklyStats/{weekStart} */
export interface WeeklyStatsDoc {
  weekStart: string;
  technical: number;
  communication: number;
  confidence: number;
  problemSolving: number;
  coding: number;
  behavior: number;
  hiringProbability: number;
  interviewsCompleted: number;
  practiceMinutes: number;
  practiceMinutesByDay: Record<string, number>;
}
