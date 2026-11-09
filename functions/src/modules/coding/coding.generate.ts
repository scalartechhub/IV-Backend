import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { generateJson } from "../../library/gemini-client";
import { db } from "../../config/firebase";
import { COLLECTIONS, CODING_SUBCOLLECTIONS } from "../../shared/constants";
import { AppError } from "../../shared/utils";
import { FieldValue } from "firebase-admin/firestore";
import {
  buildCodingProblemUserPrompt,
  CODING_PROBLEM_SYSTEM_PROMPT,
} from "../../prompts/coding/generate-coding-problem.prompt";
import { ALL_CODING_LANGUAGES, DEFAULT_CODING_LANGUAGES } from "./coding.languages";
import {
  classifyCandidateRole,
  type AssessmentType,
  type ExecutionMode,
  type RoleClassification,
} from "./coding.role-classifier";
import { runSubmission } from "./judge0.client";
import { getJudge0LanguageId } from "./coding.languages";
import type {
  CodingDifficulty,
  CodingLanguageId,
  CodingProblemDoc,
  CodingTestCase,
} from "./coding.types";
import * as repo from "./coding.repository";

const ALLOWED_ASSESSMENT_TYPES = new Set<AssessmentType>([
  "DSA",
  "SQL",
  "TESTING",
  "SCRIPTING",
  "CLOUD",
  "SECURITY",
  "NETWORKING",
  "SCENARIO",
]);

const ALLOWED_EXECUTION_MODES = new Set<ExecutionMode>([
  "JUDGE0",
  "SQL_EVALUATOR",
  "MANUAL_EVALUATION",
]);

const JUDGE0_LANG_SET = new Set<CodingLanguageId>([
  "python3",
  "javascript",
  "typescript",
  "java",
  "cpp",
  "c",
  "go",
  "csharp",
  "kotlin",
  "swift",
  "php",
  "ruby",
  "rust",
]);

interface GeneratedProblemPayload {
  title?: string;
  difficulty?: string;
  assessmentType?: string;
  executionMode?: string;
  roleDomain?: string;
  category?: string;
  tags?: string[];
  acceptance?: number;
  estimatedTimeMinutes?: number;
  description?: string;
  constraints?: string[];
  examples?: Array<{ input?: string; output?: string; explanation?: string }>;
  hints?: string[];
  solution?: {
    explanation?: string;
    codeByLanguage?: Partial<Record<string, string>>;
    referenceAnswer?: string;
    evaluationCriteria?: string[];
  };
  starterCode?: Partial<Record<string, string>>;
  publicTests?: Array<{ input?: string; expectedOutput?: string }>;
  hiddenTests?: Array<{ input?: string; expectedOutput?: string }>;
  supportedLanguages?: string[];
  primaryLanguage?: string;
  timeLimitMs?: number;
  memoryLimitMb?: number;
  databaseEngine?: string;
  sqlSchema?: string;
  sampleData?: string;
  expectedQueryResult?: string;
}

interface ProfileContext {
  displayName?: string;
  currentRole?: string;
  targetRole?: string;
  skills?: string[];
  technologies?: string[];
  preferredLanguages?: CodingLanguageId[];
  weakSpots?: string[];
  experienceSummary?: string;
  experienceLevel?: string;
  projects?: string[];
  responsibilities?: string[];
  profileFingerprint: string;
}

const LANGUAGE_HINTS: Array<{ needles: RegExp; id: CodingLanguageId }> = [
  { needles: /\b(type\s*script|typescript|\.tsx?\b|angular|nestjs)\b/i, id: "typescript" },
  { needles: /\b(java\s*script|javascript|node\.?js|react|next\.?js|vue|express|nuxt)\b/i, id: "javascript" },
  { needles: /\b(python|django|flask|fastapi|pandas|numpy)\b/i, id: "python3" },
  { needles: /\b(kotlin|android)\b/i, id: "kotlin" },
  { needles: /\b(java|spring|jvm)\b/i, id: "java" },
  { needles: /\b(c\+\+|cpp|cplus|qt)\b/i, id: "cpp" },
  { needles: /\b(?<![\w.])c(?![\w+#])\b|\bc99\b|\bembedded c\b/i, id: "c" },
  { needles: /\b(c#|csharp|\.net|asp\.net)\b/i, id: "csharp" },
  { needles: /\b(golang|go lang|\bgo\b)\b/i, id: "go" },
  { needles: /\b(rust)\b/i, id: "rust" },
  { needles: /\b(php|laravel)\b/i, id: "php" },
  { needles: /\b(ruby|rails)\b/i, id: "ruby" },
  { needles: /\b(swift|ios|swiftui)\b/i, id: "swift" },
];

const uniqStrings = (values: string[], max = 24): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
};

const collectStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        if (typeof obj.name === "string") return obj.name;
        if (typeof obj.title === "string") return obj.title;
        if (typeof obj.skill === "string") return obj.skill;
        if (typeof obj.description === "string") return obj.description;
        if (typeof obj.summary === "string") return obj.summary;
        if (typeof obj.role === "string") return obj.role;
      }
      return "";
    })
    .filter(Boolean);
};

const collectProjectBlobs = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        return [obj.title, obj.name, obj.description, obj.summary, obj.techStack]
          .flatMap((part) => (Array.isArray(part) ? part.map(String) : [String(part ?? "")]))
          .filter(Boolean)
          .join(" — ");
      }
      return "";
    })
    .filter(Boolean);
};

const inferPreferredLanguages = (tech: string[]): CodingLanguageId[] => {
  const blob = tech.join(" | ");
  const matched: CodingLanguageId[] = [];
  for (const hint of LANGUAGE_HINTS) {
    if (hint.needles.test(blob) && !matched.includes(hint.id) && JUDGE0_LANG_SET.has(hint.id)) {
      matched.push(hint.id);
    }
  }
  return matched.slice(0, 4);
};

const asCodingLanguage = (value: string | undefined): CodingLanguageId | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, CodingLanguageId> = {
    python: "python3",
    py: "python3",
    python3: "python3",
    js: "javascript",
    javascript: "javascript",
    node: "javascript",
    ts: "typescript",
    typescript: "typescript",
    "c++": "cpp",
    cpp: "cpp",
    "c#": "csharp",
    csharp: "csharp",
  };
  const mapped = aliases[normalized] ?? (normalized as CodingLanguageId);
  if (!ALL_CODING_LANGUAGES.includes(mapped) || !JUDGE0_LANG_SET.has(mapped)) {
    return undefined;
  }
  return mapped;
};

const orderLanguages = (
  preferred: CodingLanguageId[],
  fromModel: string[] | undefined
): CodingLanguageId[] => {
  const modelIds = (fromModel ?? [])
    .map((lang) => asCodingLanguage(lang))
    .filter((lang): lang is CodingLanguageId => Boolean(lang));

  const ordered: CodingLanguageId[] = [];
  for (const lang of [...preferred, ...modelIds, ...DEFAULT_CODING_LANGUAGES]) {
    if (!JUDGE0_LANG_SET.has(lang)) continue;
    if (!ordered.includes(lang)) ordered.push(lang);
  }
  return ordered.slice(0, 8);
};

const asTestCases = (
  value: Array<{ input?: string; expectedOutput?: string }> | undefined,
  min: number
): CodingTestCase[] => {
  const cases = (value ?? [])
    .map((item) => ({
      input: String(item.input ?? ""),
      expectedOutput: String(item.expectedOutput ?? ""),
    }))
    .filter((item) => item.input.trim() !== "" || item.expectedOutput.trim() !== "");

  if (cases.length < min) {
    throw new AppError(502, "AI returned too few test cases for a valid coding problem");
  }
  return cases;
};

const DSA_CATEGORIES = new Set([
  "Arrays",
  "Strings",
  "Stack",
  "Queue",
  "Sliding Window",
  "Hash Table",
  "Hash Maps",
  "Two Pointers",
  "Sorting",
  "Searching",
  "Recursion",
  "Math",
  "Mathematics",
]);

const normalizeCategory = (assessmentType: AssessmentType, value: string | undefined): string => {
  const raw = String(value ?? "").trim();
  if (assessmentType === "DSA") {
    if (DSA_CATEGORIES.has(raw)) return raw === "Hash Maps" ? "Hash Table" : raw;
    return "Arrays";
  }
  if (raw) return raw.slice(0, 64);
  return assessmentType;
};

const fingerprintProfile = (parts: Record<string, unknown>): string =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);

const loadCachedClassification = async (
  uid: string,
  fingerprint: string
): Promise<RoleClassification | null> => {
  const snap = await db
    .collection(COLLECTIONS.USERS)
    .doc(uid)
    .collection(CODING_SUBCOLLECTIONS.PROGRESS)
    .doc("_classification")
    .get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  if (data.profileFingerprint !== fingerprint) return null;
  if (!ALLOWED_ASSESSMENT_TYPES.has(data.assessmentType as AssessmentType)) return null;
  return {
    assessmentType: data.assessmentType as AssessmentType,
    executionMode: data.executionMode as ExecutionMode,
    roleDomain: String(data.roleDomain ?? ""),
    reason: String(data.reason ?? ""),
    isActiveCoder: Boolean(data.isActiveCoder),
  };
};

const saveCachedClassification = async (
  uid: string,
  fingerprint: string,
  classification: RoleClassification
): Promise<void> => {
  await db
    .collection(COLLECTIONS.USERS)
    .doc(uid)
    .collection(CODING_SUBCOLLECTIONS.PROGRESS)
    .doc("_classification")
    .set(
      {
        ...classification,
        profileFingerprint: fingerprint,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
};

const buildProfileContext = async (uid: string): Promise<ProfileContext> => {
  const userSnap = await db.collection(COLLECTIONS.USERS).doc(uid).get();
  if (!userSnap.exists) {
    throw new AppError(404, "User profile not found");
  }
  const user = userSnap.data() ?? {};
  const onboardingSnap =
    user.onboarding && typeof user.onboarding === "object"
      ? (user.onboarding as Record<string, unknown>)
      : {};

  const analysisSnap = await db
    .collection(COLLECTIONS.USERS)
    .doc(uid)
    .collection("onboarding")
    .doc("analysis")
    .get();
  const analysis = analysisSnap.exists ? analysisSnap.data() ?? {} : {};

  const resumeSnap = await db
    .collection(COLLECTIONS.USERS)
    .doc(uid)
    .collection("resume")
    .doc("analysis")
    .get();
  const resume = resumeSnap.exists ? resumeSnap.data() ?? {} : {};

  const skills = uniqStrings([
    ...collectStringList(user.skills),
    ...collectStringList(onboardingSnap.primarySkills),
    ...collectStringList(analysis.skills),
    ...collectStringList(resume.skills),
    ...collectStringList(analysis.skillGapAnalysis),
  ]);

  const sessionSubskills = Array.isArray(analysis.recommendedSessions)
    ? analysis.recommendedSessions.flatMap((session: unknown) => {
        if (!session || typeof session !== "object") return [];
        const row = session as Record<string, unknown>;
        return [
          ...collectStringList(row.subskills),
          typeof row.name === "string" ? row.name : "",
        ];
      })
    : [];

  const technologies = uniqStrings([
    ...skills,
    ...collectStringList(onboardingSnap.recommendedLearningTechnologies),
    ...collectStringList(analysis.recommendedLearningTechnologies),
    ...collectStringList(onboardingSnap.learningPriorities),
    ...sessionSubskills,
    ...collectStringList(analysis.careerPath),
    ...collectStringList(resume.technologies),
    ...collectStringList(resume.tools),
  ]);

  const projects = uniqStrings([
    ...collectProjectBlobs(resume.projects),
    ...collectProjectBlobs(analysis.projects),
    ...collectProjectBlobs(user.projects),
  ]).slice(0, 8);

  const responsibilities = uniqStrings([
    ...collectStringList(resume.responsibilities),
    ...collectStringList(analysis.responsibilities),
    ...collectStringList(user.responsibilities),
    ...collectStringList(resume.experience),
  ]).slice(0, 10);

  const preferredLanguages = inferPreferredLanguages(technologies);

  const highPriorityGaps = Array.isArray(analysis.skillGapAnalysis)
    ? analysis.skillGapAnalysis
        .filter(
          (item: unknown) =>
            item &&
            typeof item === "object" &&
            String((item as { priority?: unknown }).priority ?? "").toLowerCase() === "high"
        )
        .map((item: unknown) => String((item as { name?: unknown }).name ?? ""))
    : [];

  const weakSpots = uniqStrings([
    ...collectStringList(user.weakSpots),
    ...collectStringList(onboardingSnap.weakSkills),
    ...highPriorityGaps,
  ]).slice(0, 10);

  const summary =
    (typeof analysis.resumeStrengthSummary === "string" && analysis.resumeStrengthSummary) ||
    (typeof analysis.summary === "string" && analysis.summary) ||
    (typeof analysis.headline === "string" && analysis.headline) ||
    (typeof resume.summary === "string" && resume.summary) ||
    undefined;

  const currentRole =
    (typeof user.currentRole === "string" && user.currentRole) ||
    (typeof resume.currentRole === "string" && resume.currentRole) ||
    (typeof resume.jobTitle === "string" && resume.jobTitle) ||
    undefined;

  const targetRole =
    (typeof user.targetRole === "string" && user.targetRole) ||
    (typeof onboardingSnap.selectedRole === "string" && onboardingSnap.selectedRole) ||
    (typeof analysis.jobRoleRecommendation === "string" && analysis.jobRoleRecommendation) ||
    undefined;

  const experienceLevel =
    (typeof onboardingSnap.experience === "string" && onboardingSnap.experience) ||
    (typeof analysis.experienceLevelPrediction === "string" &&
      analysis.experienceLevelPrediction) ||
    undefined;

  const profileFingerprint = fingerprintProfile({
    currentRole,
    targetRole,
    skills: skills.slice(0, 20),
    technologies: technologies.slice(0, 24),
    projects,
    responsibilities,
    weakSpots,
    experienceLevel,
  });

  return {
    displayName: typeof user.displayName === "string" ? user.displayName : undefined,
    currentRole,
    targetRole,
    skills: skills.slice(0, 20),
    technologies: technologies.slice(0, 24),
    preferredLanguages,
    weakSpots,
    experienceSummary: summary?.slice(0, 800),
    experienceLevel,
    projects,
    responsibilities,
    profileFingerprint,
  };
};

const normalizeOutput = (value: string | null | undefined): string =>
  (value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

/** Best-effort: run reference solution on public tests before publishing DSA. */
const validateDsaWithJudge0 = async (
  problem: CodingProblemDoc,
  hiddenTests: CodingTestCase[]
): Promise<void> => {
  const langs = problem.supportedLanguages ?? [];
  const primary =
    (problem.primaryLanguage as CodingLanguageId | undefined) ??
    langs[0] ??
    "python3";
  const code =
    problem.solution?.codeByLanguage?.[primary] ||
    langs.map((lang) => problem.solution?.codeByLanguage?.[lang]).find(Boolean);

  if (!code || typeof code !== "string" || !code.trim()) {
    throw new AppError(502, "DSA solution missing reference code for validation");
  }

  const tests = [...(problem.publicTests ?? []), ...hiddenTests].slice(0, 4);
  if (tests.length < 2) {
    throw new AppError(502, "DSA problem needs at least 2 tests for validation");
  }

  const languageId = getJudge0LanguageId(primary);
  for (const test of tests) {
    try {
      const result = await runSubmission({
        source_code: code,
        language_id: languageId,
        stdin: test.input,
        expected_output: test.expectedOutput,
        cpu_time_limit: 3,
        memory_limit: 256000,
      });
      const actual = normalizeOutput(result.stdout);
      const expected = normalizeOutput(test.expectedOutput);
      const statusId = result.status?.id;
      const passed =
        (statusId === 3 || actual === expected) &&
        actual === expected &&
        statusId !== 6;
      if (!passed) {
        throw new AppError(
          502,
          `DSA reference solution failed Judge0 validation (${result.status?.description ?? "mismatch"})`
        );
      }
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 502) throw err;
      // Judge0 unavailable — skip hard fail so generation still works offline.
      console.warn("[coding.generate] Judge0 pre-check skipped:", err);
      return;
    }
  }
};

const assertValidAiPayload = (
  raw: GeneratedProblemPayload,
  classification: RoleClassification
): void => {
  const title = String(raw.title ?? "").trim();
  const description = String(raw.description ?? "").trim();
  if (!title || !description) {
    throw new AppError(502, "AI returned an incomplete assessment");
  }
  if (String(raw.difficulty ?? "").trim() !== "Easy") {
    throw new AppError(502, "AI returned non-Easy difficulty");
  }

  const assessmentType = (raw.assessmentType ?? classification.assessmentType) as AssessmentType;
  const executionMode = (raw.executionMode ?? classification.executionMode) as ExecutionMode;

  if (!ALLOWED_ASSESSMENT_TYPES.has(assessmentType)) {
    throw new AppError(502, `Invalid assessmentType: ${raw.assessmentType}`);
  }
  if (!ALLOWED_EXECUTION_MODES.has(executionMode)) {
    throw new AppError(502, `Invalid executionMode: ${raw.executionMode}`);
  }
  if (assessmentType !== classification.assessmentType) {
    throw new AppError(
      502,
      `AI assessmentType ${assessmentType} does not match classification ${classification.assessmentType}`
    );
  }
  if (executionMode !== classification.executionMode) {
    throw new AppError(
      502,
      `AI executionMode ${executionMode} does not match classification ${classification.executionMode}`
    );
  }

  if (assessmentType === "DSA") {
    if (executionMode !== "JUDGE0") {
      throw new AppError(502, "DSA assessments must use JUDGE0");
    }
    asTestCases(raw.publicTests, 2);
    asTestCases(raw.hiddenTests, 2);
    const langs = (raw.supportedLanguages ?? [])
      .map((lang) => asCodingLanguage(lang))
      .filter(Boolean);
    if (langs.length === 0 && !(raw.starterCode && Object.keys(raw.starterCode).length)) {
      throw new AppError(502, "DSA assessment missing supported languages / starter code");
    }
  } else if (assessmentType === "SQL") {
    if (executionMode !== "SQL_EVALUATOR") {
      throw new AppError(502, "SQL assessments must use SQL_EVALUATOR");
    }
    if (!String(raw.sqlSchema ?? "").trim() || !String(raw.solution?.referenceAnswer ?? "").trim()) {
      throw new AppError(502, "SQL assessment missing schema or reference answer");
    }
    const criteria = raw.solution?.evaluationCriteria ?? [];
    if (!Array.isArray(criteria) || criteria.length < 3) {
      throw new AppError(502, "SQL assessment needs at least 3 evaluation criteria");
    }
  } else {
    if (executionMode !== "MANUAL_EVALUATION") {
      throw new AppError(502, `${assessmentType} assessments must use MANUAL_EVALUATION`);
    }
    if (!String(raw.solution?.referenceAnswer ?? "").trim()) {
      throw new AppError(502, "Manual assessment missing reference answer");
    }
    const criteria = raw.solution?.evaluationCriteria ?? [];
    if (!Array.isArray(criteria) || criteria.length < 3) {
      throw new AppError(502, "Manual assessment needs at least 3 evaluation criteria");
    }
  }
};

const buildProblemFromRaw = (
  raw: GeneratedProblemPayload,
  classification: RoleClassification,
  profile: ProfileContext
): { problem: CodingProblemDoc; hiddenTests: CodingTestCase[] } => {
  assertValidAiPayload(raw, classification);

  const assessmentType = classification.assessmentType;
  const executionMode = classification.executionMode;
  const title = String(raw.title ?? "").trim();
  const description = String(raw.description ?? "").trim();
  const problemId = `ai-${uuidv4()}`;

  const tags = uniqStrings([
    ...(Array.isArray(raw.tags) ? raw.tags.map(String) : []),
    assessmentType,
    ...(profile.technologies ?? []).slice(0, 4),
  ]).slice(0, 8);

  const estimatedTimeMinutes =
    typeof raw.estimatedTimeMinutes === "number" && Number.isFinite(raw.estimatedTimeMinutes)
      ? Math.round(Math.min(30, Math.max(20, raw.estimatedTimeMinutes)))
      : 25;

  const acceptance =
    typeof raw.acceptance === "number" && Number.isFinite(raw.acceptance)
      ? Math.round(Math.min(95, Math.max(40, raw.acceptance)))
      : 80;

  if (assessmentType === "DSA") {
    const publicTests = asTestCases(raw.publicTests, 2);
    const hiddenTests = asTestCases(raw.hiddenTests, 2);
    const preferred = profile.preferredLanguages?.length
      ? profile.preferredLanguages
      : (["python3", "javascript"] as CodingLanguageId[]);
    const supportedLanguages = orderLanguages(preferred, raw.supportedLanguages);
    const primaryLanguage =
      asCodingLanguage(raw.primaryLanguage) ?? preferred[0] ?? supportedLanguages[0] ?? "python3";
    const orderedSupported = [
      primaryLanguage,
      ...supportedLanguages.filter((lang) => lang !== primaryLanguage),
    ];

    const starterCode = (raw.starterCode ?? {}) as CodingProblemDoc["starterCode"];
    const codeByLanguage = (raw.solution?.codeByLanguage ??
      {}) as CodingProblemDoc["solution"]["codeByLanguage"];

    for (const lang of orderedSupported) {
      if (!JUDGE0_LANG_SET.has(lang)) {
        throw new AppError(502, `Unsupported language id: ${lang}`);
      }
    }

    const problem: CodingProblemDoc = {
      id: problemId,
      title,
      difficulty: "Easy",
      assessmentType,
      executionMode,
      roleDomain: classification.roleDomain || String(raw.roleDomain ?? "Software Development"),
      category: normalizeCategory(assessmentType, raw.category),
      tags,
      acceptance,
      estimatedTimeMinutes,
      description,
      constraints: Array.isArray(raw.constraints) ? raw.constraints.map(String) : [],
      examples: (raw.examples ?? [])
        .map((ex) => ({
          input: String(ex.input ?? ""),
          output: String(ex.output ?? ""),
          ...(ex.explanation ? { explanation: String(ex.explanation) } : {}),
        }))
        .filter((ex) => ex.input || ex.output),
      hints: Array.isArray(raw.hints) ? raw.hints.map(String).slice(0, 5) : [],
      solution: {
        explanation: String(raw.solution?.explanation ?? ""),
        codeByLanguage,
        referenceAnswer: "",
        evaluationCriteria: [],
      },
      starterCode,
      publicTests,
      supportedLanguages: orderedSupported,
      primaryLanguage,
      timeLimitMs:
        typeof raw.timeLimitMs === "number" && raw.timeLimitMs > 0 ? raw.timeLimitMs : 2000,
      memoryLimitMb:
        typeof raw.memoryLimitMb === "number" && raw.memoryLimitMb > 0 ? raw.memoryLimitMb : 256,
      isActive: true,
      order: Date.now(),
    };

    return { problem, hiddenTests };
  }

  // Non-DSA: empty Judge0 fields
  const criteria = (raw.solution?.evaluationCriteria ?? []).map(String).slice(0, 8);
  const problem: CodingProblemDoc = {
    id: problemId,
    title,
    difficulty: "Easy",
    assessmentType,
    executionMode,
    roleDomain: classification.roleDomain || String(raw.roleDomain ?? assessmentType),
    category: normalizeCategory(assessmentType, raw.category),
    tags,
    acceptance,
    estimatedTimeMinutes,
    description,
    constraints: Array.isArray(raw.constraints) ? raw.constraints.map(String) : [],
    examples: (raw.examples ?? [])
      .map((ex) => ({
        input: String(ex.input ?? ""),
        output: String(ex.output ?? ""),
        ...(ex.explanation ? { explanation: String(ex.explanation) } : {}),
      }))
      .filter((ex) => ex.input || ex.output),
    hints: Array.isArray(raw.hints) ? raw.hints.map(String).slice(0, 5) : [],
    solution: {
      explanation: String(raw.solution?.explanation ?? ""),
      codeByLanguage: {},
      referenceAnswer: String(raw.solution?.referenceAnswer ?? ""),
      evaluationCriteria: criteria,
    },
    starterCode: {},
    publicTests: [],
    supportedLanguages: [],
    primaryLanguage: "",
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    ...(assessmentType === "SQL"
      ? {
          databaseEngine: String(raw.databaseEngine ?? "PostgreSQL"),
          sqlSchema: String(raw.sqlSchema ?? ""),
          sampleData: String(raw.sampleData ?? ""),
          expectedQueryResult: String(raw.expectedQueryResult ?? ""),
        }
      : {}),
    isActive: true,
    order: Date.now(),
  };

  return { problem, hiddenTests: [] };
};

const callGeminiOnce = async (
  profile: ProfileContext,
  classification: RoleClassification,
  focusTopic?: string
): Promise<GeneratedProblemPayload> =>
  generateJson<GeneratedProblemPayload>({
    systemInstruction: CODING_PROBLEM_SYSTEM_PROMPT,
    userPrompt: buildCodingProblemUserPrompt({
      ...profile,
      preferredLanguages: profile.preferredLanguages,
      focusTopic,
      assessmentType: classification.assessmentType,
      executionMode: classification.executionMode,
      roleDomain: classification.roleDomain,
      classificationReason: classification.reason,
    }),
    temperature: 0.35,
    maxOutputTokens: 8192,
  });

export const generateProblemForUser = async (
  uid: string,
  options?: { difficulty?: CodingDifficulty; focusTopic?: string }
): Promise<CodingProblemDoc> => {
  void options?.difficulty;
  const profile = await buildProfileContext(uid);

  let classification = await loadCachedClassification(uid, profile.profileFingerprint);
  if (!classification) {
    classification = classifyCandidateRole({
      currentRole: profile.currentRole,
      targetRole: profile.targetRole,
      skills: profile.skills,
      technologies: profile.technologies,
      projects: profile.projects,
      responsibilities: profile.responsibilities,
      weakSpots: profile.weakSpots,
      focusTopic: options?.focusTopic,
      experienceSummary: profile.experienceSummary,
    });
    await saveCachedClassification(uid, profile.profileFingerprint, classification);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callGeminiOnce(profile, classification, options?.focusTopic);
      const { problem, hiddenTests } = buildProblemFromRaw(raw, classification, profile);

      if (problem.assessmentType === "DSA") {
        await validateDsaWithJudge0(problem, hiddenTests);
      }

      await repo.saveGeneratedProblem(uid, problem, hiddenTests);

      await db
        .collection(COLLECTIONS.USERS)
        .doc(uid)
        .collection(CODING_SUBCOLLECTIONS.PROGRESS)
        .doc(problem.id)
        .set(
          {
            problemId: problem.id,
            status: "attempted",
            source: "ai_profile",
            assessmentType: problem.assessmentType,
            executionMode: problem.executionMode,
            roleDomain: problem.roleDomain,
            primaryLanguage: problem.primaryLanguage ?? "",
            stack: (profile.technologies ?? []).slice(0, 8),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      return problem;
    } catch (err) {
      lastError = err;
      console.warn(`[coding.generate] attempt ${attempt + 1} failed:`, err);
    }
  }

  if (lastError instanceof AppError) throw lastError;
  throw new AppError(502, "Failed to generate a valid assessment after retry");
};
