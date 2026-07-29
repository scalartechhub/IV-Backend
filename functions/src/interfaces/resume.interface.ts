// Mirrors src/app/interfaces/resume.interface.ts ù keep in sync
import type { Timestamp } from 'firebase-admin/firestore';

export type AnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type FixSeverity = 'high' | 'medium' | 'low';
export type PreparationPriority = 'High' | 'Medium' | 'Low';
export type SkillLevel = 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
export type CompanyDifficulty = 'Easy' | 'Medium' | 'Hard';

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

/** Nested analysis block on users/{uid}/resume/analysis */
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
  // TODO: architecture ùReview recommends extractedText for re-analysis without re-parsing
  extractedText?: string;
  /** Interview-prep plan nested under analysis when onboarding=true */
  onboarding?: ResumeOnboardingPlan;
}

/** Career preparation topic for onboarding plan */
export interface CareerPathTopic {
  id: string;
  title: string;
  description: string;
  priority: PreparationPriority;
  estimatedHours: number;
  completed: boolean;
  order: number;
}

export interface RecommendedCompany {
  name: string;
  reason: string;
  difficulty: CompanyDifficulty;
  priority: number;
}

export interface SkillGapItem {
  name: string;
  currentLevel: SkillLevel;
  targetLevel: SkillLevel;
  priority: PreparationPriority;
  reason: string;
  estimatedHours: number;
}

export interface LearningRoadmapWeek {
  week: number;
  title: string;
  topics: string[];
  hours: number;
  goal: string;
  checkpoint: string;
  mockInterview: string;
}

export interface InterviewPrepCategory {
  category: string;
  questionsCount: number;
  priority: PreparationPriority;
  recommendation: string;
}

export interface RecommendedProject {
  title: string;
  description: string;
  skills: string[];
  estimatedHours: number;
  priority: PreparationPriority;
}

export interface RecommendedCertification {
  name: string;
  provider: string;
  reason: string;
  priority: PreparationPriority;
}

export interface RecommendedResource {
  title: string;
  type: 'Official Docs' | 'Course' | 'Book' | 'YouTube' | 'Practice Platform' | 'GitHub';
  url?: string;
  reason: string;
}

export interface MarketReadinessScore {
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  hiringReadiness: string;
  expectedSalaryBand?: string;
}

export interface NextAction {
  order: number;
  action: string;
  priority: PreparationPriority;
  estimatedHours?: number;
}

/**
 * Onboarding plan generated alongside resume ATS analysis.
 * Appended to users/{uid}/resume/analysis when onboarding=true.
 */
export interface ResumeOnboardingPlan {
  careerPath: CareerPathTopic[];
  recommendedCompanies: RecommendedCompany[];
  skillGapAnalysis: SkillGapItem[];
  learningRoadmap: LearningRoadmapWeek[];
  interviewPreparation: InterviewPrepCategory[];
  recommendedInterviewTracks: string[];
  resumeStrengthSummary: string;
  priorityPreparationAreas: string[];
  estimatedPreparationWeeks: number;
  confidencePrediction: number;
  industryRecommendation: string;
  jobRoleRecommendation: string;
  experienceLevelPrediction: string;
  resumeCompleteness: number;
  marketReadinessScore: MarketReadinessScore;
  recommendedProjects: RecommendedProject[];
  recommendedCertifications: RecommendedCertification[];
  recommendedResources: RecommendedResource[];
  nextActions: NextAction[];
  generatedAt: string;
}

/** Path: users/{uid}/resumes/{resumeId} or users/{uid}/resume/analysis */
export interface ResumeDoc {
  fileName: string;
  /** Omitted when PDF is analyzed in-memory and not uploaded to Storage. */
  storagePath?: string;
  version: number;
  isActive: boolean;
  uploadedAt: Timestamp;
  targetRole: string;
  /** ATS scores + optional nested onboarding plan */
  analysis: ResumeAnalysis;
  aiReviewedAt: Timestamp;
  analysisStatus: AnalysisStatus;
}
