export type CodingLanguageId =
  | "cpp"
  | "java"
  | "python3"
  | "c"
  | "csharp"
  | "javascript"
  | "typescript"
  | "php"
  | "swift"
  | "kotlin"
  | "dart"
  | "go"
  | "ruby"
  | "scala"
  | "rust"
  | "racket"
  | "erlang"
  | "elixir";

export type CodingDifficulty = "Easy" | "Medium" | "Hard";

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

export type SubmissionVerdict =
  | "accepted"
  | "wrong_answer"
  | "runtime_error"
  | "compile_error"
  | "time_limit_exceeded"
  | "memory_limit_exceeded"
  | "pending_review";

export interface CodingTestCase {
  input: string;
  expectedOutput: string;
}

export interface CodingExample {
  input: string;
  output: string;
  explanation?: string;
}

export interface CodingSolution {
  explanation: string;
  codeByLanguage: Partial<Record<CodingLanguageId, string>>;
  /** Model answer for SQL / manual assessments. */
  referenceAnswer?: string;
  /** Measurable scoring criteria for manual / SQL review. */
  evaluationCriteria?: string[];
}

export interface CodingProblemDoc {
  id: string;
  title: string;
  difficulty: CodingDifficulty;
  /** Defaults to DSA for legacy problems missing this field. */
  assessmentType?: AssessmentType;
  /** Defaults to JUDGE0 for legacy problems missing this field. */
  executionMode?: ExecutionMode;
  roleDomain?: string;
  category: string;
  tags?: string[];
  acceptance: number;
  estimatedTimeMinutes?: number;
  description: string;
  constraints?: string[];
  examples: CodingExample[];
  hints: string[];
  solution: CodingSolution;
  starterCode: Partial<Record<CodingLanguageId, string>>;
  publicTests: CodingTestCase[];
  supportedLanguages: CodingLanguageId[];
  primaryLanguage?: string;
  timeLimitMs?: number;
  memoryLimitMb?: number;
  /** SQL assessments only. */
  databaseEngine?: string;
  sqlSchema?: string;
  sampleData?: string;
  expectedQueryResult?: string;
  order?: number;
  isActive?: boolean;
}

export interface CodingProblemSecretsDoc {
  problemId: string;
  hiddenTests: CodingTestCase[];
}

export interface CodingTestResult {
  index: number;
  passed: boolean;
  /** Omitted for hidden tests on submit responses. */
  input?: string;
  /** Omitted for hidden tests on submit responses. */
  expectedOutput?: string;
  actualOutput?: string;
  stderr?: string;
  runtimeMs?: number;
  memoryKb?: number;
  status: SubmissionVerdict;
  /** True when this case came from codingProblemSecrets (never sent to client as I/O). */
  hidden?: boolean;
}

export interface CodingRunResult {
  verdict: SubmissionVerdict;
  passedCount: number;
  totalCount: number;
  results: CodingTestResult[];
}

export interface CodingSubmitResult extends CodingRunResult {
  xpEarned: number;
  solved: boolean;
  submissionId: string;
}

export interface CodingLanguageInfo {
  id: CodingLanguageId;
  label: string;
  monacoLanguage: string;
  judge0Id: number;
  fileExtension: string;
  defaultTemplate: string;
}

export interface Judge0Submission {
  source_code: string;
  language_id: number;
  stdin?: string;
  expected_output?: string;
  cpu_time_limit?: number;
  memory_limit?: number;
}

export interface Judge0Result {
  token: string;
  status?: { id: number; description: string };
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  time?: string | null;
  memory?: number | null;
}
