// Mirrors src/app/interfaces/resume.interface.ts ? keep in sync
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

/* ── New rich resume-review contract (results-page payload) ── */

export type SuggestionType = 'critical' | 'warning' | 'info';
export type SectionId =
  | 'contact'
  | 'summary'
  | 'experience'
  | 'skills'
  | 'projects'
  | 'education'
  | 'certifications'
  | 'achievements'
  | 'additional'
  | string;
export type AtsCheckStatus = 'good' | 'minor' | 'neutral';
export type KeywordDensityTone = 'success' | 'warning' | 'danger';

export interface ResumeScoreBlock {
  overall: number;
  overallMessage?: string;
  impact: number;
  content: number;
  structure: number;
  ats: number;
  relevance: number;
  peerPercentile?: number;
}

export interface ResumeScoreLabels {
  impact?: string;
  content?: string;
  structure?: string;
  ats?: string;
  relevance?: string;
}

export interface ResumeListItem {
  id: string;
  text: string;
}

export interface ResumeSuggestionItem {
  id: string;
  text: string;
  severity: FixSeverity;
  type?: SuggestionType;
  priority: number;
}

export interface ResumeAiFeedbackBlock {
  overallFeedback: string;
  recruiterComment: string;
}

export interface ResumeSectionItem {
  id: SectionId;
  label: string;
  score: number;
  feedback: string;
  looksGood: boolean;
}

export interface ResumeKeywordItem {
  keyword: string;
}

export interface ResumeKeywordDensityItem {
  label: 'Optimal' | 'Too Low' | 'Too High' | string;
  percent: number;
  tone: KeywordDensityTone;
}

export interface ResumeKeywordsBlock {
  matchScore: number;
  matchLabel?: string;
  matchHint?: string;
  totalKeywords: number;
  matchedCount: number;
  matchedPercent: number;
  missingCount: number;
  missingPercent: number;
  matched: ResumeKeywordItem[];
  missing: ResumeKeywordItem[];
  density: ResumeKeywordDensityItem[];
  recommendations?: string[];
}

export interface ResumeAtsCheckResultItem {
  id: string;
  label: string;
  status: AtsCheckStatus;
  statusLabel: string;
}

export interface ResumeAtsRecommendationItem {
  text: string;
  reason: string;
}

export interface ResumeAtsBlock {
  compatibilityScore: number;
  compatibilityLabel?: string;
  compatibilityHint?: string;
  checkResults: ResumeAtsCheckResultItem[];
  previewSnippet: string;
  parseScore: number;
  recommendations: ResumeAtsRecommendationItem[];
}

export interface ResumeRoleMatchItem {
  role: string;
  score: number;
  label: string;
  feedback: string;
}

export interface ResumeDetailedMetrics {
  keywordMatch: ScoreWithDelta;
  quantifiedImpact: ScoreWithDelta;
  actionVerbs: ScoreWithDelta;
  structureLength: ScoreWithDelta;
}

/**
 * Nested analysis block on users/{uid}/onboarding/analysis.
 *
 * Superset shape: legacy flat fields (overallScore, atsScore, fixesFirst, …) are kept so the
 * currently-shipped Angular resume-analysis page keeps rendering unchanged, while the richer
 * results-page contract (scores, suggestions, sections, keywords, ats, roleMatches, …) is
 * generated and stored alongside for the redesigned results page. Legacy fields are DERIVED
 * from the rich fields in resume.service.ts — Gemini only ever produces the rich shape.
 */
export interface ResumeAnalysis {
  isCoder?: boolean;
  /* Legacy (derived) — kept for backward compatibility */
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
  // TODO: architecture ?Review recommends extractedText for re-analysis without re-parsing
  extractedText?: string;
  /** Interview-prep plan nested under analysis when onboarding=true */
  onboarding?: ResumeOnboardingPlan;

  /* Rich results-page contract */
  experienceLevel: string;
  scores: ResumeScoreBlock;
  atsFriendly: boolean;
  scoreLabels?: ResumeScoreLabels;
  strengths: ResumeListItem[];
  areasToImprove: ResumeListItem[];
  suggestions: ResumeSuggestionItem[];
  aiFeedback: ResumeAiFeedbackBlock;
  sections: ResumeSectionItem[];
  keywords: ResumeKeywordsBlock;
  ats: ResumeAtsBlock;
  roleMatches: ResumeRoleMatchItem[];
  detailedMetrics: ResumeDetailedMetrics;
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
  website: string;
  reason: string;
  /** 2–5 interview-relevant skills for this employer (practice company cards). */
  skills: string[];
  priority: number;
}

/** Practice “Recommended sessions” — title + skill name + subskills. */
export interface RecommendedSessionSkill {
  /** Short interview title shown on Practice cards and passed as interview topic. */
  title: string;
  /** Primary skill / category name (logo + category). */
  name: string;
  subskills: string[];
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
 * Interview-prep plan generated during onboarding (resume upload or Q&A).
 * Stored at users/{uid}/onboarding/analysis under analysis.onboarding.
 */
export interface ResumeOnboardingPlan {
  careerPath: CareerPathTopic[];
  recommendedCompanies: RecommendedCompany[];
  /** Exactly 10 practice skills; each has 2–5 subskills (no duration/difficulty/XP). */
  recommendedSessions: RecommendedSessionSkill[];
  skillGapAnalysis: SkillGapItem[];
  learningRoadmap: LearningRoadmapWeek[];
  interviewPreparation: InterviewPrepCategory[];
  recommendedInterviewTracks: string[];
  /** Technologies to learn, inferred from the resume ? powers the onboarding "Learning Roadmap" step. */
  recommendedLearningTechnologies: string[];
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

/** Alias ? plan is shared by resume and questions onboarding. */
export type OnboardingPlan = ResumeOnboardingPlan;

export type OnboardingAnalysisSource = 'resume' | 'questions';

/**
 * Canonical path: users/{uid}/onboarding/analysis
 */
export interface ResumeDoc {
  /** Stable per-user identifier, generated once and preserved across re-analyze. */
  resumeId?: string;
  /** Regenerated on every analyze call — identifies this specific analysis run. */
  analysisId?: string;
  fileName: string;
  /** "PDF" | "DOCX" — derived from the uploaded file extension. */
  fileType?: string;
  /** Omitted when PDF is analyzed in-memory and not uploaded to Storage. */
  storagePath?: string;
  version: number;
  isActive: boolean;
  uploadedAt: Timestamp;
  /** Same instant as aiReviewedAt — exposed under the results-page contract's field name. */
  lastAnalyzedAt?: Timestamp;
  targetRole: string;
  /** e.g. "Mid-Senior Level" — inferred by Gemini from the resume content. */
  experienceLevel?: string;
  /** ATS scores + optional nested onboarding plan */
  analysis: ResumeAnalysis;
  aiReviewedAt: Timestamp;
  analysisStatus: AnalysisStatus;
  /** How this analysis was produced ? resume PDF vs Q&A answers. */
  source?: OnboardingAnalysisSource;
}

/** Preferred name for the unified onboarding analysis doc. */
export type OnboardingAnalysisDoc = ResumeDoc;

export interface ResumeAnalysisPayload {
  isCoder?: boolean;
  resumeId: string;
  analysisId: string;
  fileName: string;
  fileType: string;
  storagePath: string;
  analysisStatus: AnalysisStatus;
  uploadedAt: string;
  lastAnalyzedAt: string;
  targetRole: string;
  experienceLevel: string;

  scores: ResumeScoreBlock;
  atsFriendly: boolean;
  scoreLabels?: ResumeScoreLabels;

  strengths: ResumeListItem[];
  areasToImprove: ResumeListItem[];
  suggestions: ResumeSuggestionItem[];

  aiFeedback: ResumeAiFeedbackBlock;
  sections: ResumeSectionItem[];
  keywords: ResumeKeywordsBlock;
  ats: ResumeAtsBlock;
  roleMatches: ResumeRoleMatchItem[];
  detailedMetrics?: ResumeDetailedMetrics;
  extractedText?: string;
}

/** Actual `data` returned by resumeService.analyzeResume — payload contract + back-compat extras. */
export interface AnalyzeResumeApiResult extends ResumeAnalysisPayload {
  /** Legacy nested shape consumed by the current Angular resume-analysis page + onboarding wizard. */
  analysis: ResumeAnalysis;
  onboardingGenerated: boolean;
  onboardingPreserved: boolean;
}
