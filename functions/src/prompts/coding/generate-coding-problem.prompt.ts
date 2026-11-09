import type { AssessmentType, ExecutionMode } from "../../modules/coding/coding.role-classifier";

export const CODING_PROBLEM_SYSTEM_PROMPT = `You are InterviewUp's role-based technical assessment designer.
Generate ONE original Easy assessment tailored to the candidate's classified role domain.

GLOBAL RULES (always):
- difficulty MUST be "Easy". Never Medium or Hard.
- estimatedTimeMinutes: 20–30 (prefer 25).
- Output a single JSON object only (no markdown fences).
- Do NOT copy famous LeetCode titles. Create original wording.
- Personalize context using the candidate's real technologies, projects, and role — but keep difficulty Easy.
- Experience level personalizes context only; it must NOT raise difficulty.
- Follow the assigned assessmentType and executionMode exactly. Do not switch types.

When assessmentType is DSA and executionMode is JUDGE0:
- Produce a genuine DSA coding problem (Arrays, Strings, Hash Maps, Two Pointers, Sorting, Searching, Stack, Queue, Sliding Window, Basic Recursion, or Mathematics).
- Prefer Arrays/Strings/Hash Maps when they fit.
- Flavor the narrative with the candidate's stack (Angular API records, React component lists, Node transactions, Java employee data, Python transforms, etc.) but solve via stdin/stdout — NOT a real framework or network calls.
- Do NOT replace DSA with generic framework quizzes.
- supportedLanguages: put preferredLanguages first, then extras from
  ["python3","javascript","typescript","java","cpp","c","go","csharp","kotlin","swift","php","ruby","rust"].
- If preferredLanguages is empty, default primary to python3 and javascript.
- starterCode and solution.codeByLanguage MUST include every supported language with idiomatic templates.
- publicTests: 2–3; hiddenTests: 2–3 Easy edge cases. Exact stdout after trim.
- solution.referenceAnswer: short empty string "".
- solution.evaluationCriteria: [].
- sqlSchema / sampleData / expectedQueryResult: omit or null.

When assessmentType is SQL and executionMode is SQL_EVALUATOR:
- Practical SQL query-writing assessment (SELECT/WHERE, JOIN, GROUP BY/HAVING, aggregates, subqueries, duplicates, constraints, indexes, transactions, normalization basics, or simple optimization).
- Include databaseEngine (e.g. "PostgreSQL" or "MySQL"), sqlSchema (CREATE TABLE statements), sampleData (INSERT or tabular text), expectedQueryResult (result table as text).
- solution.referenceAnswer: correct SQL query.
- solution.evaluationCriteria: 3–5 measurable criteria.
- starterCode: {}; codeByLanguage: {}; supportedLanguages: []; primaryLanguage: "".
- publicTests / hiddenTests: [] (do not invent Judge0 stdin tests).
- Do NOT pretend Judge0 can run SQL.

When assessmentType is TESTING | SCRIPTING | CLOUD | SECURITY | NETWORKING | SCENARIO
and executionMode is MANUAL_EVALUATION:
- Realistic professional scenario grounded in the candidate's tools and responsibilities.
- solution.referenceAnswer: model answer (paragraphs or structured bullets).
- solution.evaluationCriteria: 3–5 measurable scoring criteria.
- starterCode: {}; codeByLanguage: {}; supportedLanguages: []; primaryLanguage: "".
- publicTests / hiddenTests: [].
- Do NOT generate fake Judge0 starter code.

JSON shape:
{
  "title": string,
  "difficulty": "Easy",
  "assessmentType": "DSA" | "SQL" | "TESTING" | "SCRIPTING" | "CLOUD" | "SECURITY" | "NETWORKING" | "SCENARIO",
  "executionMode": "JUDGE0" | "SQL_EVALUATOR" | "MANUAL_EVALUATION",
  "roleDomain": string,
  "category": string,
  "tags": string[],
  "acceptance": number,
  "estimatedTimeMinutes": number,
  "description": string,
  "constraints": string[],
  "examples": [{ "input": string, "output": string, "explanation"?: string }],
  "hints": string[],
  "solution": {
    "explanation": string,
    "codeByLanguage": { "<langId>": string },
    "referenceAnswer": string,
    "evaluationCriteria": string[]
  },
  "starterCode": { "<langId>": string },
  "publicTests": [{ "input": string, "expectedOutput": string }],
  "hiddenTests": [{ "input": string, "expectedOutput": string }],
  "supportedLanguages": string[],
  "primaryLanguage": string,
  "timeLimitMs": 2000,
  "memoryLimitMb": 256,
  "databaseEngine"?: string,
  "sqlSchema"?: string,
  "sampleData"?: string,
  "expectedQueryResult"?: string
}`;

export const buildCodingProblemUserPrompt = (profile: {
  displayName?: string;
  currentRole?: string;
  targetRole?: string;
  skills?: string[];
  technologies?: string[];
  preferredLanguages?: string[];
  weakSpots?: string[];
  experienceSummary?: string;
  experienceLevel?: string;
  focusTopic?: string;
  projects?: string[];
  responsibilities?: string[];
  assessmentType: AssessmentType;
  executionMode: ExecutionMode;
  roleDomain: string;
  classificationReason?: string;
}): string => {
  const skills = profile.skills?.length ? profile.skills.join(", ") : "not listed";
  const technologies = profile.technologies?.length
    ? profile.technologies.join(", ")
    : skills !== "not listed"
      ? skills
      : "general IT";
  const preferred = profile.preferredLanguages?.length
    ? profile.preferredLanguages.join(", ")
    : "python3, javascript";
  const weak = profile.weakSpots?.length ? profile.weakSpots.join(", ") : "none specified";
  const projects = profile.projects?.length ? profile.projects.join(" | ") : "not listed";
  const responsibilities = profile.responsibilities?.length
    ? profile.responsibilities.join(" | ")
    : "not listed";
  const focus = profile.focusTopic?.trim()
    ? `Focus topic preference (secondary): ${profile.focusTopic.trim()}.`
    : "No focus topic override.";

  const typeGuidance: Record<AssessmentType, string> = {
    DSA: "Generate an Easy DSA coding problem (stdin/stdout). Flavor with their stack; do not replace DSA with framework trivia.",
    SQL: "Generate a practical Easy SQL query assessment with schema, sample data, expected result, and reference SQL.",
    TESTING: "Generate an Easy testing/QA assessment (test cases, BVA, automation scenario) with reference answer + criteria.",
    SCRIPTING: "Generate an Easy scripting/ops assessment (bash/python/logs/CI) with reference answer + criteria.",
    CLOUD: "Generate an Easy cloud/infra assessment (Docker/K8s/CI/CD/deploy) with reference answer + criteria.",
    SECURITY: "Generate an Easy security assessment (validation, logs, threat basics) with reference answer + criteria.",
    NETWORKING: "Generate an Easy networking assessment (IP/subnet/troubleshoot) with reference answer + criteria.",
    SCENARIO: "Generate an Easy management/BA scenario (prioritization, incidents, stakeholders) with reference answer + criteria.",
  };

  return `Candidate profile (resume / onboarding — ground truth):
- Name: ${profile.displayName || "Candidate"}
- Current role: ${profile.currentRole || "not specified"}
- Target role: ${profile.targetRole || "not specified"}
- Experience level: ${profile.experienceLevel || "not specified"}
- Resume skills: ${skills}
- Technologies / stack: ${technologies}
- Projects: ${projects}
- Responsibilities: ${responsibilities}
- Preferred Judge0 languages (DSA only): ${preferred}
- Weak spots: ${weak}
- Background: ${profile.experienceSummary || "not specified"}
- ${focus}

CLASSIFICATION (server-assigned — obey exactly):
- assessmentType: ${profile.assessmentType}
- executionMode: ${profile.executionMode}
- roleDomain: ${profile.roleDomain}
- reason: ${profile.classificationReason || "n/a"}

Instructions:
- Required difficulty: Easy (fixed).
- estimatedTimeMinutes: 25.
- ${typeGuidance[profile.assessmentType]}
- Set assessmentType and executionMode fields in JSON to exactly the values above.

Generate one Easy assessment JSON now.`;
};
