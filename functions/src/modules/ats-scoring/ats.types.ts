import { RoleBenchmark } from "../../constants/roles-benchmarks";
export type { RoleBenchmark };

export interface ParsedResume {
  skills?: string[];
  experience?: {
    title: string;
    company: string;
    duration: string;
    description: string;
  }[];
  projects?: {
    name: string;
    description: string;
  }[];
  education?: {
    degree: string;
    university: string;
    year: string;
  }[];
}

export interface MetricScore {
  score: number;
  change: number;
}

export interface Suggestion {
  type: "warning" | "info";
  icon: string;
  text: string;
  priority: number;
}

export interface PositiveItem {
  text: string;
}

/** Dashboard-shaped resume analysis payload (matches frontend ResumeAnalysisResponse). */
export interface ResumeAnalysisResponse {
  resumeId: string;
  fileName: string;
  targetRole: string;
  experience: string;
  aiReviewed: boolean;
  overallScore: number;
  peerPercentile: number;
  subMetrics: {
    ats: number;
    impact: number;
    clarity: number;
  };
  detailedMetrics: {
    keywordMatch: MetricScore;
    quantifiedImpact: MetricScore;
    actionVerbs: MetricScore;
    structureLength: MetricScore;
  };
  fixSuggestions: Suggestion[];
  workingWell: PositiveItem[];
  analyzedAt: string;
}

/** Raw AI scores before request metadata is attached. */
export interface AtsScorePayload {
  overallScore: number;
  peerPercentile: number;
  experience?: string;
  targetRole?: string;
  subMetrics: {
    ats: number;
    impact: number;
    clarity: number;
  };
  detailedMetrics: {
    keywordMatch: MetricScore;
    quantifiedImpact: MetricScore;
    actionVerbs: MetricScore;
    structureLength: MetricScore;
  };
  fixSuggestions: Suggestion[];
  workingWell: PositiveItem[];
}

export interface AtsAnalysisDoc {
  id?: string;
  userId: string;
  resumeId: string;
  fileName: string;
  targetRole: string;
  experience: string;
  aiReviewed: boolean;
  overallScore: number;
  peerPercentile: number;
  subMetrics: ResumeAnalysisResponse["subMetrics"];
  detailedMetrics: ResumeAnalysisResponse["detailedMetrics"];
  fixSuggestions: Suggestion[];
  workingWell: PositiveItem[];
  analyzedAt: string;
  resumeSnippet?: string;
  jobTitle?: string;
  createdAt?: string | any;
}

export interface AnalyzeRequest {
  resumeId: string;
  fileName?: string;
  experience?: string;
  resumeText?: string;
  parsedResume?: ParsedResume;
  jobDescription?: string;
  targetRole?: string;
}
