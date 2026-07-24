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

export type SubmissionVerdict =
  | "accepted"
  | "wrong_answer"
  | "runtime_error"
  | "compile_error"
  | "time_limit_exceeded";

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
}

export interface CodingProblemDoc {
  id: string;
  title: string;
  difficulty: CodingDifficulty;
  category: string;
  tags?: string[];
  acceptance: number;
  description: string;
  constraints?: string[];
  examples: CodingExample[];
  hints: string[];
  solution: CodingSolution;
  starterCode: Partial<Record<CodingLanguageId, string>>;
  publicTests: CodingTestCase[];
  supportedLanguages: CodingLanguageId[];
  timeLimitMs?: number;
  memoryLimitMb?: number;
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
  input: string;
  expectedOutput: string;
  actualOutput?: string;
  stderr?: string;
  runtimeMs?: number;
  status: SubmissionVerdict;
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
