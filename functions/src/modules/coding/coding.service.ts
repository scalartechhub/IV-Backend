import { v4 as uuidv4 } from "uuid";
import { runSubmission } from "./judge0.client";
import { getJudge0LanguageId } from "./coding.languages";
import * as repo from "./coding.repository";
import type {
  CodingLanguageId,
  CodingRunResult,
  CodingSubmitResult,
  CodingTestCase,
  CodingTestResult,
  Judge0Result,
  SubmissionVerdict,
} from "./coding.types";
import { AppError } from "../../shared/utils";

const MAX_SOURCE_BYTES = 64 * 1024;

const JUDGE0_STATUS = {
  ACCEPTED: 3,
  WRONG_ANSWER: 4,
  TIME_LIMIT: 5,
  COMPILATION_ERROR: 6,
  RUNTIME_ERROR: 11,
} as const;

const XP_BY_DIFFICULTY: Record<string, number> = {
  Easy: 10,
  Medium: 25,
  Hard: 50,
};

const normalizeOutput = (value: string | null | undefined): string =>
  (value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

const mapJudge0Status = (result: Judge0Result): SubmissionVerdict => {
  const id = result.status?.id;
  if (id === JUDGE0_STATUS.ACCEPTED) return "accepted";
  if (id === JUDGE0_STATUS.WRONG_ANSWER) return "wrong_answer";
  if (id === JUDGE0_STATUS.TIME_LIMIT) return "time_limit_exceeded";
  if (id === JUDGE0_STATUS.COMPILATION_ERROR) return "compile_error";
  return "runtime_error";
};

const runSingleTest = async (
  sourceCode: string,
  language: CodingLanguageId,
  test: CodingTestCase,
  timeLimitMs: number,
  memoryLimitMb: number,
  compareOutput: boolean
): Promise<CodingTestResult & { runtimeMs?: number }> => {
  const languageId = getJudge0LanguageId(language);
  const cpuLimit = Math.max(1, Math.ceil(timeLimitMs / 1000));

  // Judge0 memory_limit is KB; cap inside judge0.client (max 512000)
  const memoryLimitKb = Math.min(memoryLimitMb * 1024, 512000);

  const result = await runSubmission({
    source_code: sourceCode,
    language_id: languageId,
    stdin: test.input,
    expected_output: compareOutput ? test.expectedOutput : undefined,
    cpu_time_limit: cpuLimit,
    memory_limit: memoryLimitKb,
  });

  const verdict = mapJudge0Status(result);
  const actualOutput = normalizeOutput(result.stdout);
  const expectedOutput = normalizeOutput(test.expectedOutput);

  let passed = verdict === "accepted";
  if (compareOutput && test.expectedOutput !== "") {
    passed = passed || actualOutput === expectedOutput;
    if (verdict === "accepted" && actualOutput !== expectedOutput) {
      passed = actualOutput === expectedOutput;
    }
  } else if (!compareOutput) {
    passed = verdict !== "compile_error" && verdict !== "runtime_error";
  }

  const stderr = result.stderr || result.compile_output || undefined;
  const runtimeMs = result.time ? Math.round(parseFloat(result.time) * 1000) : undefined;

  return {
    index: 0,
    passed,
    input: test.input,
    expectedOutput: test.expectedOutput,
    actualOutput: actualOutput || undefined,
    stderr: stderr ?? undefined,
    runtimeMs,
    status: passed ? "accepted" : verdict === "accepted" ? "wrong_answer" : verdict,
  };
};

const executeTests = async (
  sourceCode: string,
  language: CodingLanguageId,
  tests: CodingTestCase[],
  timeLimitMs: number,
  memoryLimitMb: number,
  compareOutput: boolean
): Promise<CodingRunResult> => {
  const results: CodingTestResult[] = [];

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    const result = await runSingleTest(
      sourceCode,
      language,
      test,
      timeLimitMs,
      memoryLimitMb,
      compareOutput
    );
    results.push({ ...result, index: i });
  }

  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;

  let verdict: SubmissionVerdict = "accepted";
  if (passedCount < totalCount) {
    const firstFail = results.find((r) => !r.passed);
    verdict = firstFail?.status ?? "wrong_answer";
  }

  return { verdict, passedCount, totalCount, results };
};

const validateSource = (sourceCode: string): void => {
  if (!sourceCode.trim()) {
    throw new AppError(400, "Source code cannot be empty");
  }
  if (Buffer.byteLength(sourceCode, "utf8") > MAX_SOURCE_BYTES) {
    throw new AppError(400, "Source code exceeds maximum size (64KB)");
  }
};

export const runCode = async (
  uid: string,
  problemId: string,
  language: CodingLanguageId,
  sourceCode: string,
  customInput?: string
): Promise<CodingRunResult> => {
  validateSource(sourceCode);

  const problem = await repo.assertProblemExists(problemId);

  if (!problem.supportedLanguages?.includes(language)) {
    throw new AppError(400, `Language ${language} is not supported for this problem`);
  }

  const tests = repo.getTestsForRun(problem, customInput);
  const compareOutput = !(customInput !== undefined && customInput.trim() !== "");

  const result = await executeTests(
    sourceCode,
    language,
    tests,
    problem.timeLimitMs ?? 2000,
    problem.memoryLimitMb ?? 256,
    compareOutput
  );

  await repo.upsertProgress(uid, problemId, {
    status: "attempted",
    lastLanguage: language,
  });

  return result;
};

export const submitCode = async (
  uid: string,
  problemId: string,
  language: CodingLanguageId,
  sourceCode: string
): Promise<CodingSubmitResult> => {
  validateSource(sourceCode);

  const problem = await repo.assertProblemExists(problemId);

  if (!problem.supportedLanguages?.includes(language)) {
    throw new AppError(400, `Language ${language} is not supported for this problem`);
  }

  const tests = await repo.getTestsForSubmit(problem);

  const result = await executeTests(
    sourceCode,
    language,
    tests,
    problem.timeLimitMs ?? 2000,
    problem.memoryLimitMb ?? 256,
    true
  );

  const solved = result.verdict === "accepted" && result.passedCount === result.totalCount;
  const xpEarned = solved ? (XP_BY_DIFFICULTY[problem.difficulty] ?? 10) : 0;

  const submissionId = uuidv4();
  await repo.saveSubmission(uid, submissionId, {
    problemId,
    language,
    status: result.verdict,
    passed: solved,
    passedCount: result.passedCount,
    totalCount: result.totalCount,
    xpEarned,
  });

  if (solved) {
    await repo.upsertProgress(uid, problemId, {
      status: "solved",
      lastLanguage: language,
    });
  } else {
    await repo.upsertProgress(uid, problemId, {
      status: "attempted",
      lastLanguage: language,
    });
  }

  return { ...result, xpEarned, solved };
};
