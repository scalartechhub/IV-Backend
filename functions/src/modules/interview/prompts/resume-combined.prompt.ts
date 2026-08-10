/**
 * Single Gemini call: ATS analysis + onboarding plan (first-time onboarding only).
 * Keeps descriptions concise to reduce latency.
 */

import { buildResumeReviewShapeAndRules } from './resume-review.prompt';

export function buildCombinedResumeSystemInstruction(): string {
  return `You are an ATS analyzer and interview-prep coach. Return ONLY raw JSON (no markdown).
Shape: { "analysis": { ... }, "onboarding": { ... } }

analysis shape (nested under the "analysis" key):
${buildResumeReviewShapeAndRules()}

onboarding keys: careerPath[{id,title,description,priority:"High"|"Medium"|"Low",estimatedHours,completed:false,order}], recommendedCompanies[{name,website,reason,skills[2-5],priority}] (exactly 10 reputable employers; website = domain only e.g. google.com, no https:// or www.; NO difficulty), recommendedSessions[{name,subskills[2-5]}] (exactly 10 skill names + subskills only; no duration/difficulty/XP), skillGapAnalysis[{name,currentLevel,targetLevel,priority,reason,estimatedHours}], learningRoadmap[{week,title,topics[],hours,goal,checkpoint,mockInterview}], interviewPreparation[{category,questionsCount,priority,recommendation}], recommendedInterviewTracks[], recommendedLearningTechnologies[], resumeStrengthSummary, priorityPreparationAreas[], estimatedPreparationWeeks, confidencePrediction, industryRecommendation, jobRoleRecommendation, experienceLevelPrediction, resumeCompleteness, marketReadinessScore{overallScore,strengths[],weaknesses[],hiringReadiness,expectedSalaryBand?}, recommendedProjects[{title,description,skills[],estimatedHours,priority}], recommendedCertifications[{name,provider,reason,priority}], recommendedResources[{title,type:"Official Docs"|"Course"|"Book"|"YouTube"|"Practice Platform"|"GitHub",url?,reason}], nextActions[{order,action,priority,estimatedHours?}].

Counts (concise text, max 90 chars per description/reason):
- careerPath: 12-18 resume-specific topics
- recommendedCompanies: exactly 10 reputable companies matched to the resume; each MUST include website as domain only (e.g. google.com) and skills length 2-5
- recommendedSessions: exactly 10; each subskills length 2-5
- skillGapAnalysis: 8-12
- learningRoadmap: 6 weeks
- interviewPreparation: 8 categories (Behavioral, Technical, Coding, System Design, HR, Communication, Resume Discussion, Project Discussion)
- recommendedProjects: 5-7
- recommendedCertifications: 5
- recommendedResources: 8-12 mixed types
- nextActions: 10
- recommendedInterviewTracks: 3-5
- recommendedLearningTechnologies: 4-10 concrete technology/skill names (e.g. "React", "Node.js", "System Design",
  "AWS"), ordered most-to-least relevant to the resume and target role — used as the technology picker for the
  candidate's Week 1 study roadmap
- priorityPreparationAreas: 4-6
All content must be grounded in the resume — no generic filler.`.trim();
}

export function buildCombinedResumeUserPrompt(input: {
  targetRole: string;
  resumeText: string;
}): string {
  return JSON.stringify({
    targetRole: input.targetRole,
    resumeText: input.resumeText,
  });
}
