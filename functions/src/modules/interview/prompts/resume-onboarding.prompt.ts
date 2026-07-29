/**
 * Gemini prompt builder for resume onboarding plan generation.
 * Returns STRICT JSON only — no markdown, no fences, no prose.
 */

import type { ResumeAnalysis } from '../../../interfaces/resume.interface';

export function buildResumeOnboardingSystemInstruction(): string {
  return `You are an expert career coach and technical interview preparation architect.
Respond ONLY with valid raw JSON. No markdown. No code fences. No explanations.

Generate a personalized interview-preparation onboarding plan from the resume analysis and resume text.
All topics, skills, companies, and projects MUST be grounded in the candidate's actual resume — never generic filler.

Required JSON shape (exact keys):
{
  "careerPath": [
    {
      "id": "javascript",
      "title": "Modern JavaScript",
      "description": "Master ES6+, async programming and closures.",
      "priority": "High",
      "estimatedHours": 12,
      "completed": false,
      "order": 1
    }
  ],
  "recommendedCompanies": [
    {
      "name": "Google",
      "reason": "Strong Angular and Firebase experience",
      "difficulty": "Hard",
      "priority": 1
    }
  ],
  "skillGapAnalysis": [
    {
      "name": "RxJS",
      "currentLevel": "Intermediate",
      "targetLevel": "Advanced",
      "priority": "High",
      "reason": "Reactive programming questions frequently appear in Angular interviews.",
      "estimatedHours": 10
    }
  ],
  "learningRoadmap": [
    {
      "week": 1,
      "title": "JavaScript Foundations",
      "topics": ["JavaScript", "TypeScript", "Coding"],
      "hours": 12,
      "goal": "Solidify core language skills",
      "checkpoint": "Complete 10 coding problems",
      "mockInterview": "30-min JS fundamentals mock"
    }
  ],
  "interviewPreparation": [
    {
      "category": "Behavioral",
      "questionsCount": 15,
      "priority": "High",
      "recommendation": "Practice STAR stories from your projects"
    }
  ],
  "recommendedInterviewTracks": ["string"],
  "resumeStrengthSummary": "string",
  "priorityPreparationAreas": ["string"],
  "estimatedPreparationWeeks": 6,
  "confidencePrediction": 72,
  "industryRecommendation": "string",
  "jobRoleRecommendation": "string",
  "experienceLevelPrediction": "string",
  "resumeCompleteness": 78,
  "marketReadinessScore": {
    "overallScore": 70,
    "strengths": ["string"],
    "weaknesses": ["string"],
    "hiringReadiness": "string",
    "expectedSalaryBand": "optional string if confidence allows"
  },
  "recommendedProjects": [
    {
      "title": "string",
      "description": "string",
      "skills": ["string"],
      "estimatedHours": 20,
      "priority": "High"
    }
  ],
  "recommendedCertifications": [
    {
      "name": "string",
      "provider": "string",
      "reason": "string",
      "priority": "Medium"
    }
  ],
  "recommendedResources": [
    {
      "title": "string",
      "type": "Official Docs",
      "url": "https://...",
      "reason": "string"
    }
  ],
  "nextActions": [
    {
      "order": 1,
      "action": "string",
      "priority": "High",
      "estimatedHours": 2
    }
  ]
}

HARD CONSTRAINTS:
- careerPath: 20 to 30 topics, priority High|Medium|Low, completed always false, order 1..N
- recommendedCompanies: exactly 10, prefer matches from resume; include well-known tech employers when relevant (Google, Microsoft, Amazon, Adobe, Atlassian, Salesforce, Oracle, TCS, Infosys, Accenture) or better fits
- skillGapAnalysis: at least 10 skills based on resume gaps vs target role
- learningRoadmap: 6 to 8 weeks with title, topics, hours, goal, checkpoint, mockInterview
- interviewPreparation: MUST include categories: Behavioral, Technical, Coding, System Design, HR, Communication, Resume Discussion, Project Discussion
- recommendedProjects: 5 to 10 portfolio projects targeting resume weaknesses
- recommendedCertifications: exactly 5
- recommendedResources: mix of Official Docs, Course, Book, YouTube, Practice Platform, GitHub
- nextActions: exactly 10, ordered by priority (order 1 = highest)
- confidencePrediction and resumeCompleteness and marketReadinessScore.overallScore: integers 0-100
- estimatedPreparationWeeks: integer 4-16
- recommendedInterviewTracks: 3 to 6 track names
- priorityPreparationAreas: 3 to 8 areas
- resource type MUST be one of: Official Docs | Course | Book | YouTube | Practice Platform | GitHub
- skill levels MUST be one of: Beginner | Intermediate | Advanced | Expert
- company difficulty MUST be one of: Easy | Medium | Hard`.trim();
}

export function buildResumeOnboardingUserPrompt(input: {
  targetRole: string;
  resumeText: string;
  analysis: Omit<ResumeAnalysis, 'extractedText'>;
}): string {
  return JSON.stringify({
    targetRole: input.targetRole,
    resumeText: input.resumeText.slice(0, 12_000),
    analysisSummary: {
      overallScore: input.analysis.overallScore,
      atsScore: input.analysis.atsScore,
      impactScore: input.analysis.impactScore,
      clarityScore: input.analysis.clarityScore,
      extractedKeywords: input.analysis.extractedKeywords,
      missingKeywords: input.analysis.missingKeywords,
      recommendedSkills: input.analysis.recommendedSkills,
      fixesFirst: input.analysis.fixesFirst,
      workingWell: input.analysis.workingWell,
    },
  });
}
