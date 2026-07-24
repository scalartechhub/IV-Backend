// Mirrors src/app/interfaces/resume.interface.ts — keep in sync
import type { Timestamp } from 'firebase-admin/firestore';

export type AnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type FixSeverity = 'high' | 'medium' | 'low';

export interface ScoreWithDelta {
  score: number;
  delta: number;
}

export interface ResumeFixItem {
  id: string;
  severity: FixSeverity;
  text: string;
}

export interface ResumeWorkingWellItem {
  id: string;
  text: string;
}

/** Nested analysis block on users/{uid}/resumes/{resumeId} */
export interface ResumeAnalysis {
  overallScore: number;
  atsScore: number;
  impactScore: number;
  clarityScore: number;
  keywordMatch: ScoreWithDelta;
  quantifiedImpact: ScoreWithDelta;
  actionVerbs: ScoreWithDelta;
  structureLength: ScoreWithDelta;
  percentileVsPeers: number;
  fixesFirst: ResumeFixItem[];
  workingWell: ResumeWorkingWellItem[];
  extractedKeywords: string[];
  missingKeywords: string[];
  recommendedSkills: string[];
  recommendedInterviewIds: string[];
  // TODO: architecture Â§Review recommends extractedText for re-analysis without re-parsing
  extractedText?: string;
}

/** Path: users/{uid}/resumes/{resumeId} */
export interface ResumeDoc {
  fileName: string;
  storagePath: string;
  version: number;
  isActive: boolean;
  uploadedAt: Timestamp;
  targetRole: string;
  analysis: ResumeAnalysis;
  aiReviewedAt: Timestamp;
  analysisStatus: AnalysisStatus;
}
