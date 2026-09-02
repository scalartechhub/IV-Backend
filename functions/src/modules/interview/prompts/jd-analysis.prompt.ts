import type { InterviewDifficulty, InterviewMode } from '../../../interfaces/interview.interface';

export interface JdAnalysisOptionalContext {
  company?: string;
  targetRole?: string;
  experienceLevel?: string;
  interviewType?: InterviewMode;
  difficulty?: InterviewDifficulty;
  durationMinutes?: number;
}

export interface JdAnalysisResult {
  domain: string;
  company: string;
  targetRole: string;
  experienceLevel: 'Entry' | 'Mid' | 'Senior' | 'Lead' | 'Executive';
  skills: string[];
  technologies: string[];
  responsibilities: string[];
  technicalTopics: string[];
  behavioralTopics: string[];
  interviewType: InterviewMode;
  difficulty: InterviewDifficulty;
  durationMinutes: number;
  questionCount: number;
  isCoder: boolean;
  focusAreas: {
    technical: boolean;
    coding: boolean;
    behavioral: boolean;
    problemSolving: boolean;
    communication: boolean;
  };
}

export const buildJdAnalysisPrompt = (
  jdText: string,
  context?: JdAnalysisOptionalContext,
): string => {
  const contextBlock = context
    ? `
Optional user-provided context (prefer these when the JD is ambiguous):
- Company: ${context.company ?? '(not provided)'}
- Target role: ${context.targetRole ?? '(not provided)'}
- Experience level hint: ${context.experienceLevel ?? '(not provided)'}
- Preferred interview type: ${context.interviewType ?? '(not provided)'}
- Preferred difficulty: ${context.difficulty ?? '(not provided)'}
- Preferred duration (minutes): ${context.durationMinutes ?? '(not provided)'}
`
    : '';

  return `
You are an expert hiring analyst. Analyze the job description below and extract structured interview configuration.

${contextBlock}

Job Description:
---
${jdText.slice(0, 20000)}
---

Return ONLY valid JSON matching this schema (no markdown, no explanation):
{
  "domain": "string — industry/domain e.g. Software Engineering & IT, Civil & Structural Engineering, Marketing & Growth",
  "company": "string — employer name if stated, else empty string",
  "targetRole": "string — job title / role name",
  "experienceLevel": "Entry | Mid | Senior | Lead | Executive",
  "skills": ["string — 4-8 core skills/competencies to evaluate"],
  "technologies": ["string — 0-8 tools, frameworks, or technologies mentioned"],
  "responsibilities": ["string — 3-5 key responsibilities from the JD"],
  "technicalTopics": ["string — 3-5 technical areas to probe in the interview"],
  "behavioralTopics": ["string — 3-4 behavioral/situational areas to probe"],
  "interviewType": "conversational | coding | behavioral | system_design | hr",
  "difficulty": "easy | medium | hard",
  "durationMinutes": 15 | 30 | 45 | 60,
  "questionCount": 4 | 6 | 8,
  "isCoder": true | false,
  "focusAreas": {
    "technical": true,
    "coding": true | false,
    "behavioral": true,
    "problemSolving": true,
    "communication": true
  }
}

Rules:
- Set isCoder=true only for software/IT/data/QA roles that expect coding.
- Choose interviewType based on the role: engineers → conversational, HR roles → hr, leadership-heavy → behavioral. NEVER use "coding" — this product uses verbal and snippet-based questions only (no live code editor).
- For software roles, set focusAreas.coding=true to enable code-snippet comprehension questions (not live coding).
- Map experienceLevel from years/level language in the JD.
- difficulty: Entry → easy, Mid → medium, Senior/Lead/Executive → hard (unless context overrides).
- durationMinutes: 15 for easy/entry, 30 for medium, 45-60 for senior/hard roles.
- questionCount: 4 for 15min, 6 for 30min, 8 for 45+ min.
- Extract real skills/tools from the JD; do not invent unrelated technologies.
`.trim();
};

export const buildJdOcrPrompt = (): string =>
  `Extract ALL readable text from this job description image.
Return ONLY the extracted text as plain text (no JSON, no markdown fences).
Preserve headings, bullet points, and line breaks.
If no readable text is found, return an empty string.`.trim();
