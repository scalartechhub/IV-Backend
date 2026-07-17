import { RoleBenchmark } from "../../constants/roles-benchmarks";
export type { RoleBenchmark };

export interface ParsedResume {
  skills?: string[];
  experience: {
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

export interface AtsAnalysisResult {
  matchScore: number;
  missingKeywords: string[];
  matchedKeywords: string[];
  strengths: string[];
  actionableTips: string[];
  formattingIssues: string[];
  summary: string;
}

export interface AtsAnalysisDoc {
  id?: string;
  userId: string;
  resumeSnippet: string;
  jobTitle: string;
  analysisResult: AtsAnalysisResult;
  createdAt: string | FirebaseFirestore.Timestamp;
}

export interface AnalyzeRequest {
  resumeText?: string;
  parsedResume?: ParsedResume;
  jobDescription?: string; 
  targetRole?: string;   
}