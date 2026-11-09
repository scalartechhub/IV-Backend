/**
 * Resume/role → assessment type classifier (rules only, no Gemini).
 * Priority: current role + responsibilities → projects → target role → technologies → focus topic.
 */

export type AssessmentType =
  | "DSA"
  | "SQL"
  | "TESTING"
  | "SCRIPTING"
  | "CLOUD"
  | "SECURITY"
  | "NETWORKING"
  | "SCENARIO";

export type ExecutionMode = "JUDGE0" | "SQL_EVALUATOR" | "MANUAL_EVALUATION";

export interface RoleClassification {
  assessmentType: AssessmentType;
  executionMode: ExecutionMode;
  roleDomain: string;
  reason: string;
  isActiveCoder: boolean;
}

export interface ClassificationInput {
  currentRole?: string;
  targetRole?: string;
  skills?: string[];
  technologies?: string[];
  projects?: string[];
  responsibilities?: string[];
  weakSpots?: string[];
  focusTopic?: string;
  experienceSummary?: string;
}

const EXECUTION_BY_TYPE: Record<AssessmentType, ExecutionMode> = {
  DSA: "JUDGE0",
  SQL: "SQL_EVALUATOR",
  TESTING: "MANUAL_EVALUATION",
  SCRIPTING: "MANUAL_EVALUATION",
  CLOUD: "MANUAL_EVALUATION",
  SECURITY: "MANUAL_EVALUATION",
  NETWORKING: "MANUAL_EVALUATION",
  SCENARIO: "MANUAL_EVALUATION",
};

const DOMAIN_LABEL: Record<AssessmentType, string> = {
  DSA: "Software Development",
  SQL: "Database",
  TESTING: "QA / Testing",
  SCRIPTING: "DevOps / Scripting",
  CLOUD: "Cloud / Infrastructure",
  SECURITY: "Cybersecurity",
  NETWORKING: "Networking",
  SCENARIO: "Management / Business",
};

const match = (text: string, re: RegExp): boolean => re.test(text);

const blobOf = (input: ClassificationInput): string =>
  [
    input.currentRole,
    input.targetRole,
    ...(input.skills ?? []),
    ...(input.technologies ?? []),
    ...(input.projects ?? []),
    ...(input.responsibilities ?? []),
    ...(input.weakSpots ?? []),
    input.focusTopic,
    input.experienceSummary,
  ]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();

const roleBlob = (input: ClassificationInput): string =>
  [input.currentRole, input.targetRole].filter(Boolean).join(" | ").toLowerCase();

const hasActiveCodingSignals = (text: string): boolean =>
  match(
    text,
    /\b(angular|react|vue|next\.?js|node\.?js|express|nestjs|typescript|javascript|java|spring|python|django|flask|fastapi|kotlin|android|swift|ios|flutter|dart|golang|\bgo\b|c\+\+|cpp|c#|\.net|php|laravel|ruby|rails|full[\s-]?stack|front[\s-]?end|back[\s-]?end|software (developer|engineer)|web developer|mobile developer|application developer|sde\b|programmer)\b/i
  );

const isTechnicalLeadWithCoding = (role: string, text: string): boolean =>
  match(role, /\b(tech(nical)?\s*lead|tech\s*lead|tl\b|lead developer|engineering lead)\b/i) &&
  hasActiveCodingSignals(text);

const classifyFromText = (
  roleText: string,
  fullText: string,
  focusTopic?: string
): AssessmentType | null => {
  const focus = (focusTopic ?? "").toLowerCase();
  if (focus) {
    if (match(focus, /\b(sql|database|dba|query)\b/)) return "SQL";
    if (match(focus, /\b(test|qa|selenium|cypress|playwright)\b/)) return "TESTING";
    if (match(focus, /\b(docker|kubernet|jenkins|ci\/?cd|devops|linux|bash)\b/))
      return match(focus, /\b(docker|kubernet|cloud|aws|azure|gcp)\b/) ? "CLOUD" : "SCRIPTING";
    if (match(focus, /\b(security|soc|siem|threat)\b/)) return "SECURITY";
    if (match(focus, /\b(network|tcp|subnet|cisco)\b/)) return "NETWORKING";
    if (match(focus, /\b(dsa|array|string|algorithm|coding)\b/)) return "DSA";
    if (match(focus, /\b(scrum|agile|manager|product|business analyst|stakeholder)\b/))
      return "SCENARIO";
  }

  if (
    match(
      roleText,
      /\b(dba|database administrator|sql developer|database developer|database engineer|mysql developer|postgresql|oracle developer|sql server)\b/i
    ) ||
    (match(fullText, /\b(sql server|oracle|mysql|postgresql|pl\/?sql|t-sql)\b/i) &&
      match(roleText, /\b(database|dba|sql)\b/i) &&
      !hasActiveCodingSignals(roleText))
  ) {
    return "SQL";
  }

  if (
    match(
      roleText,
      /\b(qa|quality assurance|sdet|test engineer|automation tester|manual tester|software tester|performance tester)\b/i
    )
  ) {
    return "TESTING";
  }

  if (
    match(
      roleText,
      /\b(devops|sre|site reliability|platform engineer|cloud engineer|system administrator|sysadmin|infrastructure|build and release|release engineer)\b/i
    )
  ) {
    return match(fullText, /\b(kubernetes|k8s|aws|azure|gcp|terraform|cloudformation)\b/i)
      ? "CLOUD"
      : "SCRIPTING";
  }

  if (
    match(
      roleText,
      /\b(data analyst|data engineer|data scientist|bi developer|etl developer|analytics engineer)\b/i
    )
  ) {
    return match(fullText, /\b(python|pandas|spark|etl)\b/i) &&
      !match(fullText, /\b(sql|power bi|tableau)\b/i)
      ? "SCRIPTING"
      : "SQL";
  }

  if (
    match(
      roleText,
      /\b(cybersecurity|security analyst|soc analyst|information security|security engineer)\b/i
    )
  ) {
    return "SECURITY";
  }

  if (
    match(roleText, /\b(network engineer|network administrator|network admin|networking)\b/i)
  ) {
    return "NETWORKING";
  }

  if (
    match(
      roleText,
      /\b(engineering manager|technical manager|it manager|project manager|scrum master|product manager|business analyst|delivery manager|program manager)\b/i
    ) &&
    !isTechnicalLeadWithCoding(roleText, fullText)
  ) {
    // BA with strong SQL and little coding → SQL; else scenario
    if (
      match(roleText, /\bbusiness analyst\b/i) &&
      match(fullText, /\bsql\b/i) &&
      !hasActiveCodingSignals(fullText)
    ) {
      return "SQL";
    }
    return "SCENARIO";
  }

  if (isTechnicalLeadWithCoding(roleText, fullText) || hasActiveCodingSignals(roleText)) {
    return "DSA";
  }

  if (hasActiveCodingSignals(fullText)) {
    return "DSA";
  }

  if (match(fullText, /\b(selenium|cypress|playwright|testng|junit|pytest|qa)\b/i)) {
    return "TESTING";
  }

  if (match(fullText, /\b(docker|kubernetes|jenkins|terraform|ansible)\b/i)) {
    return "CLOUD";
  }

  if (
    match(fullText, /\b(sql|mysql|postgresql|oracle|snowflake)\b/i) &&
    !hasActiveCodingSignals(fullText)
  ) {
    return "SQL";
  }

  return null;
};

export const classifyCandidateRole = (input: ClassificationInput): RoleClassification => {
  const full = blobOf(input);
  const roles = roleBlob(input);

  // Priority: current/target role text first, then full resume blob, then focus.
  const fromRole = classifyFromText(roles || full, full, input.focusTopic);
  const assessmentType: AssessmentType = fromRole ?? (hasActiveCodingSignals(full) ? "DSA" : "SCENARIO");

  // Hard rule: active software developers / coding tech leads → DSA
  const forceDsa =
    isTechnicalLeadWithCoding(roles, full) ||
    match(
      roles,
      /\b(software developer|software engineer|frontend|backend|full[\s-]?stack|web developer|mobile developer|angular developer|react developer|node\.?js developer|java developer|python developer|application developer)\b/i
    );

  const finalType: AssessmentType = forceDsa ? "DSA" : assessmentType;
  const isActiveCoder = finalType === "DSA";

  return {
    assessmentType: finalType,
    executionMode: EXECUTION_BY_TYPE[finalType],
    roleDomain: DOMAIN_LABEL[finalType],
    reason: forceDsa
      ? "Active software/coding role — DSA assessment required"
      : `Classified as ${finalType} from role/responsibilities/stack`,
    isActiveCoder,
  };
};

export const executionModeFor = (type: AssessmentType): ExecutionMode => EXECUTION_BY_TYPE[type];
