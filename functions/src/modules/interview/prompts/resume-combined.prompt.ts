/**
 * Single Gemini call: ATS analysis + onboarding plan (first-time onboarding only).
 * Keeps descriptions concise to reduce latency.
 */

export function buildCombinedResumeSystemInstruction(): string {
  return `You are an ATS analyzer and interview-prep coach. Return ONLY raw JSON (no markdown).
Shape: { "analysis": { ... }, "onboarding": { ... } }

analysis keys: overallScore, atsScore, impactScore, clarityScore, keywordMatch{score,delta}, quantifiedImpact{score,delta}, actionVerbs{score,delta}, structureLength{score,delta}, percentileVsPeers, fixesFirst[{id,severity:"high"|"medium"|"low",text}], workingWell[{id,text}], extractedKeywords[], missingKeywords[], recommendedSkills[], recommendedInterviewIds[] (use []).
fixesFirst/workingWell: 3 items each, object arrays not strings.

onboarding keys: careerPath[{id,title,description,priority:"High"|"Medium"|"Low",estimatedHours,completed:false,order}], recommendedCompanies[{name,reason,difficulty:"Easy"|"Medium"|"Hard",priority}], skillGapAnalysis[{name,currentLevel,targetLevel,priority,reason,estimatedHours}], learningRoadmap[{week,title,topics[],hours,goal,checkpoint,mockInterview}], interviewPreparation[{category,questionsCount,priority,recommendation}], recommendedInterviewTracks[], resumeStrengthSummary, priorityPreparationAreas[], estimatedPreparationWeeks, confidencePrediction, industryRecommendation, jobRoleRecommendation, experienceLevelPrediction, resumeCompleteness, marketReadinessScore{overallScore,strengths[],weaknesses[],hiringReadiness,expectedSalaryBand?}, recommendedProjects[{title,description,skills[],estimatedHours,priority}], recommendedCertifications[{name,provider,reason,priority}], recommendedResources[{title,type:"Official Docs"|"Course"|"Book"|"YouTube"|"Practice Platform"|"GitHub",url?,reason}], nextActions[{order,action,priority,estimatedHours?}].

Counts (concise text, max 90 chars per description/reason):
- careerPath: 12-18 resume-specific topics
- recommendedCompanies: 8-10
- skillGapAnalysis: 8-12
- learningRoadmap: 6 weeks
- interviewPreparation: 8 categories (Behavioral, Technical, Coding, System Design, HR, Communication, Resume Discussion, Project Discussion)
- recommendedProjects: 5-7
- recommendedCertifications: 5
- recommendedResources: 8-12 mixed types
- nextActions: 10
- recommendedInterviewTracks: 3-5
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
