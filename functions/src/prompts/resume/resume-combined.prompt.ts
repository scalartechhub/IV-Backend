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

onboarding keys: careerPath[{id,title,description,priority:"High"|"Medium"|"Low",estimatedHours,completed:false,order}], recommendedCompanies[{name,website,reason,skills[2-5],priority}] (exactly 10 reputable employers; website = domain only e.g. google.com, no https:// or www.; NO difficulty), recommendedSessions[{title,name,subskills[2-5]}] (exactly 10; title = short interview title for card/topic, name = primary skill, subskills = badge skills; no duration/difficulty/XP), skillGapAnalysis[{name,currentLevel,targetLevel,priority,reason,estimatedHours}], learningRoadmap[{week,title,topics[],hours,goal,checkpoint,mockInterview}], interviewPreparation[{category,questionsCount,priority,recommendation}], recommendedInterviewTracks[], recommendedLearningTechnologies[], targetedRoles[], resumeStrengthSummary, priorityPreparationAreas[], estimatedPreparationWeeks, confidencePrediction, industryRecommendation, jobRoleRecommendation, experienceLevelPrediction, resumeCompleteness, marketReadinessScore{overallScore,strengths[],weaknesses[],hiringReadiness,expectedSalaryBand?}, recommendedProjects[{title,description,skills[],estimatedHours,priority}], recommendedCertifications[{name,provider,reason,priority}], recommendedResources[{title,type:"Official Docs"|"Course"|"Book"|"YouTube"|"Practice Platform"|"GitHub",url?,reason}], nextActions[{order,action,priority,estimatedHours?}].

Counts (concise text, max 90 chars per description/reason):
- careerPath: 12-18 resume-specific topics
- recommendedCompanies: exactly 10 reputable companies matched to the resume; each MUST include website as domain only (e.g. google.com) and skills length 2-5
- recommendedSessions: exactly 10; each has title, name, and subskills length 2-5
- skillGapAnalysis: 8-12
- learningRoadmap: 6 weeks
- interviewPreparation: 8 categories (Behavioral, Technical, Coding, System Design, HR, Communication, Resume Discussion, Project Discussion)
- recommendedProjects: 5-7
- recommendedCertifications: 5
- recommendedResources: 8-12 mixed types
- nextActions: 10
- recommendedInterviewTracks: 3-5
- targetedRoles: exactly 5 resume-grounded job-role titles in the SAME industry as the resume (e.g. tech: "Frontend Developer", "React JS Developer"; legal: "Legal Consultant", "Corporate Lawyer", "Legal Analyst", "Litigation Associate", "Compliance Officer") — NEVER mix industries; NEVER skills, topics, modules, or technologies (NOT "Advanced React Hooks", "TypeScript Generics", "Unit Testing"); each MUST be a single role title only — no commas, slashes, "and", "or", or multi-role lists; must differ from each other
- recommendedLearningTechnologies: 4-10 concrete technology/skill names (e.g. "React", "Node.js", "System Design",
  "AWS"), ordered most-to-least relevant to the resume and target role — used as the technology picker for the
  candidate's Week 1 study roadmap
- priorityPreparationAreas: 4-6
- jobRoleRecommendation: exactly one role title only, based on the candidate's most likely current/professional role from the resume; no commas, slashes, "and", "or", or multi-role lists
- experienceLevelPrediction: total professional work experience from the resume ONLY. Compute from employment dates (earliest start → latest end/Present, or sum of non-overlapping roles). Prefer an explicit "X years" line on the resume when it matches the dates. MUST be exactly one of: "Student", "0-1 years", "1-3 years", "3-5 years", "5-10 years", "10+ years". NEVER use vague labels like "Mid-level", "Senior", or "Mid-Senior Level". Internships/education-only → "Student" or "0-1 years".
- analysis.experienceLevel: same year-bucket format and resume-date rules as experienceLevelPrediction (keep both aligned)
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
