import { Request } from "express";

export interface AtsAnalysisResult {
  matchScore: number;
  missingKeyword: number;
  matchedKeywords: string[];
  strengths: string[];
  actionableTips: string[];
  formattingIssues: string[];
  summary: string;
}

export interface AtsAnalysisDoc {
  userId: string;
  resumeSnippet: string;
  jobTitle: string;
  analysisResult: string;
  createdAt: string;
}

export interface AnalyzeRequest {
  resumeText: string;
  jobDescription: string;
}

export interface AuthRequest extends Request {
  userId?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface ValidationResult {
  valid: boolean;
  message?: string;
}
