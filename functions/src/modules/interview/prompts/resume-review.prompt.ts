/**
 * Standalone Gemini call: rich resume-review analysis (results-page contract).
 * Used for re-analyze (no onboarding plan needed). See resume-combined.prompt.ts
 * for the first-time onboarding variant that also generates the interview-prep plan.
 */

const RESUME_REVIEW_SHAPE = `{
  "experienceLevel": string (e.g. "Mid-Senior Level"),
  "scores": { "overall": 0-100, "overallMessage": string (max 4 words), "impact": 0-100, "content": 0-100, "structure": 0-100, "ats": 0-100, "relevance": 0-100, "peerPercentile": 0-100 },
  "scoreLabels": { "impact": string, "content": string, "structure": string, "ats": string, "relevance": string },
  "strengths": [ { "id": "s1", "text": string } ] (4-5 items),
  "areasToImprove": [ { "id": "i1", "text": string } ] (4-5 items),
  "suggestions": [ { "id": "f1", "text": string, "severity": "high"|"medium"|"low", "type": "critical"|"warning"|"info", "priority": number } ] (4-6 items, priority 1 = most important),
  "aiFeedback": { "overallFeedback": string (2-4 sentences), "recruiterComment": string (1-2 sentences) },
  "sections": [ { "id": "contact"|"summary"|"experience"|"skills"|"projects"|"education"|"certifications"|"achievements"|"additional", "label": string, "score": 0-100, "feedback": string, "looksGood": boolean } ] (ALWAYS all 9 ids, even if the section is missing from the resume — then score low and feedback should say so),
  "keywords": {
    "matchScore": 0-100, "matchLabel": string, "matchHint": string (max 2 words),
    "totalKeywords": number, "matchedCount": number, "matchedPercent": 0-100, "missingCount": number, "missingPercent": 0-100,
    "matched": [ { "keyword": string } ], "missing": [ { "keyword": string } ],
    "density": [ { "label": "Optimal", "percent": number, "tone": "success" }, { "label": "Too Low", "percent": number, "tone": "warning" }, { "label": "Too High", "percent": number, "tone": "danger" } ] (percents sum to ~100),
    "recommendations": string[] (each item exactly 1 word — skill/keyword capsule, e.g. "Kubernetes")
  },
  "ats": {
    "compatibilityScore": 0-100, "compatibilityLabel": string, "compatibilityHint": string,
    "checkResults": [ { "id": string, "label": string, "status": "good"|"minor"|"neutral", "statusLabel": string } ] (cover: formatting, readability, tables/columns, fonts, contact-info, length — 5-6 checks),
    "previewSnippet": string (first ~400 chars of how an ATS would parse the plain text, e.g. section headers + key lines),
    "parseScore": 0-100,
    "recommendations": [ { "text": string, "reason": string } ] (3-5 items)
  },
  "roleMatches": [ { "role": string, "score": 0-100, "label": string, "feedback": string (max 5 words) } ] (the target role first, then 1-2 closely related roles this resume also fits),
  "detailedMetrics": {
    "keywordMatch": { "score": 0-100, "delta": number }, "quantifiedImpact": { "score": 0-100, "delta": number },
    "actionVerbs": { "score": 0-100, "delta": number }, "structureLength": { "score": 0-100, "delta": number }
  },
  "recommendedSkills": string[],
  "recommendedInterviewIds": []
}`;

const SHARED_RULES = `
Scoring rubric (0-100):
- scores.ats / ats.compatibilityScore: plain-text structure, standard headings, no complex tables/columns.
- scores.impact: ownership + outcomes (metrics, %, scale). No numbers -> <=60. Several -> >=75.
- scores.content: clarity, early role signal, consistent bullets, no fluff.
- scores.structure: 1-2 page equivalent length, clear section order, consistent formatting.
- scores.relevance / keywords.matchScore: how well the resume's stack/experience matches targetRole.
- scores.overall: holistic average of the 5 sub-scores, weighted toward impact and relevance.
- atsFriendly badge on the frontend is derived as scores.ats >= 70 — score accordingly.

UI brevity (hard limits — do not exceed):
- scores.overallMessage: max 4 words (e.g. "Strong technical foundation").
- keywords.matchHint: max 2 words (e.g. "Add metrics").
- keywords.recommendations: each entry exactly one word (keyword/skill capsule only, no phrases).
- roleMatches[].feedback: max 5 words (e.g. "Solid fit, deepen metrics").

Ground every strength, suggestion, section feedback, and aiFeedback line in real content from the
resume text — cite concrete phrases/sections when possible, never generic filler. suggestions must
be actionable rewrites, not vague advice. Output ONLY raw JSON (no markdown fences, no commentary).`;

/** The JSON shape + scoring rules, reusable as-is inside a larger combined prompt. */
export function buildResumeReviewShapeAndRules(): string {
  return `${RESUME_REVIEW_SHAPE}
${SHARED_RULES}`.trim();
}

export function buildResumeReviewSystemInstruction(): string {
  return `You are an expert ATS resume analyzer and technical recruiter. Return ONLY raw JSON matching this exact shape:
${buildResumeReviewShapeAndRules()}`.trim();
}

export function buildResumeReviewUserPrompt(input: { targetRole: string; resumeText: string }): string {
  return JSON.stringify({
    targetRole: input.targetRole,
    resumeText: input.resumeText,
  });
}
