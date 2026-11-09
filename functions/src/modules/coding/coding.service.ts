import { v4 as uuidv4 } from "uuid";
import { JUDGE0_MAX_MEMORY_KB, runSubmission } from "./judge0.client";
import { getJudge0LanguageId, listCodingLanguages } from "./coding.languages";
import { hashSourceCode, withCodingExecutionSlot } from "./coding.execution-guard";
import { assertJudge0Executable, isAutomatedJudge0Problem } from "./coding.evaluators";
import * as repo from "./coding.repository";
import type {
  CodingLanguageId,
  CodingLanguageInfo,
  CodingProblemDoc,
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
} as const;

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
  const description = (result.status?.description ?? "").toLowerCase();

  if (id === JUDGE0_STATUS.ACCEPTED) return "accepted";
  if (id === JUDGE0_STATUS.WRONG_ANSWER) return "wrong_answer";
  if (id === JUDGE0_STATUS.TIME_LIMIT) return "time_limit_exceeded";
  if (id === JUDGE0_STATUS.COMPILATION_ERROR) return "compile_error";
  if (description.includes("memory limit")) return "memory_limit_exceeded";
  return "runtime_error";
};

const runSingleTest = async (
  sourceCode: string,
  language: CodingLanguageId,
  test: CodingTestCase,
  timeLimitMs: number,
  memoryLimitMb: number,
  compareOutput: boolean
): Promise<CodingTestResult> => {
  const languageId = getJudge0LanguageId(language);
  const cpuLimit = Math.max(1, Math.ceil(timeLimitMs / 1000));

  // Judge0 memory_limit is KB; final clamp also applied in judge0.client
  const memoryLimitKb = Math.min(memoryLimitMb * 1024, JUDGE0_MAX_MEMORY_KB);

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
    passed =
      verdict !== "compile_error" &&
      verdict !== "runtime_error" &&
      verdict !== "memory_limit_exceeded" &&
      verdict !== "time_limit_exceeded";
  }

  const stderr = result.stderr || result.compile_output || undefined;
  const runtimeMs = result.time ? Math.round(parseFloat(result.time) * 1000) : undefined;
  const memoryKb = typeof result.memory === "number" ? result.memory : undefined;

  return {
    index: 0,
    passed,
    input: test.input,
    expectedOutput: test.expectedOutput,
    actualOutput: actualOutput || undefined,
    stderr: stderr ?? undefined,
    runtimeMs,
    memoryKb,
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

/** Strip hidden-case I/O so candidates cannot probe secret tests via submit. */
const sanitizeSubmitResults = (
  results: CodingTestResult[],
  publicCount: number
): CodingTestResult[] =>
  results.map((result, index) => {
    const hidden = index >= publicCount;
    if (!hidden) {
      return { ...result, hidden: false };
    }
    return {
      index: result.index,
      passed: result.passed,
      status: result.status,
      runtimeMs: result.runtimeMs,
      memoryKb: result.memoryKb,
      stderr: result.stderr,
      hidden: true,
    };
  });

const validateSource = (sourceCode: string): void => {
  if (!sourceCode.trim()) {
    throw new AppError(400, "Source code cannot be empty");
  }
  if (Buffer.byteLength(sourceCode, "utf8") > MAX_SOURCE_BYTES) {
    throw new AppError(400, "Source code exceeds maximum size (64KB)");
  }
};

export const listLanguages = (): CodingLanguageInfo[] => listCodingLanguages();

export { generateProblemForUser } from "./coding.generate";

export const listQuestions = async (
  uid: string
): Promise<Array<CodingProblemDoc & { solved: boolean }>> => {
  const [problems, progress] = await Promise.all([
    repo.listGeneratedProblems(uid),
    repo.getProgressForUser(uid),
  ]);

  return problems
    .filter((problem) => problem.isActive !== false)
    .map((problem) => ({
      ...problem,
      solved: progress.get(problem.id)?.status === "solved",
    }));
};

export const getQuestion = async (uid: string, questionId: string): Promise<CodingProblemDoc> =>
  repo.assertProblemExists(uid, questionId);

export const runCode = async (
  uid: string,
  problemId: string,
  language: CodingLanguageId,
  sourceCode: string,
  customInput?: string
): Promise<CodingRunResult> =>
  withCodingExecutionSlot(uid, async () => {
    validateSource(sourceCode);

    const problem = await repo.assertProblemExists(uid, problemId);
    assertJudge0Executable(problem);

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
  });

const submitManualAnswer = async (
  uid: string,
  problem: CodingProblemDoc,
  answerText: string,
  idempotencyKey?: string
): Promise<CodingSubmitResult> => {
  const trimmed = answerText.trim();
  if (!trimmed) {
    throw new AppError(400, "Answer text cannot be empty");
  }
  if (Buffer.byteLength(trimmed, "utf8") > 32 * 1024) {
    throw new AppError(400, "Answer text exceeds maximum size (32KB)");
  }

  const submissionId = uuidv4();
  const xpEarned = 0;
  // Not auto-graded — recorded for review. Do not mark solved.
  const response: CodingSubmitResult = {
    verdict: "pending_review",
    passedCount: 0,
    totalCount: 0,
    results: [],
    xpEarned,
    solved: false,
    submissionId,
  };

  await repo.saveSubmission(uid, submissionId, {
    problemId: problem.id,
    language: "manual",
    status: "pending_review",
    passed: false,
    passedCount: 0,
    totalCount: 0,
    xpEarned,
    sourceHash: hashSourceCode(trimmed),
    answerText: trimmed,
    assessmentType: problem.assessmentType ?? "SCENARIO",
    executionMode: problem.executionMode ?? "MANUAL_EVALUATION",
    evaluationCriteria: problem.solution?.evaluationCriteria ?? [],
  });

  await repo.upsertProgress(uid, problem.id, {
    status: "attempted",
    lastSubmissionStatus: "pending_review",
  });

  if (idempotencyKey) {
    await repo.saveIdempotentResult(
      uid,
      idempotencyKey,
      response as unknown as Record<string, unknown>
    );
  }

  return response;
};

export const submitCode = async (
  uid: string,
  problemId: string,
  language: CodingLanguageId | undefined,
  sourceCode: string | undefined,
  idempotencyKey?: string,
  answerText?: string
): Promise<CodingSubmitResult> => {
  if (idempotencyKey) {
    const cached = await repo.getIdempotentResult(uid, idempotencyKey);
    if (cached) {
      return cached as unknown as CodingSubmitResult;
    }
  }

  const problem = await repo.assertProblemExists(uid, problemId);

  if (!isAutomatedJudge0Problem(problem)) {
    if (!answerText?.trim()) {
      throw new AppError(
        400,
        "This assessment requires a written answer (answerText). Automated Judge0 submit is not available."
      );
    }
    return submitManualAnswer(uid, problem, answerText, idempotencyKey);
  }

  return withCodingExecutionSlot(uid, async () => {
    if (idempotencyKey) {
      const cached = await repo.getIdempotentResult(uid, idempotencyKey);
      if (cached) {
        return cached as unknown as CodingSubmitResult;
      }
    }

    if (!language || !sourceCode) {
      throw new AppError(400, "language and sourceCode are required for DSA submissions");
    }

    validateSource(sourceCode);
    assertJudge0Executable(problem);

    if (!problem.supportedLanguages?.includes(language)) {
      throw new AppError(400, `Language ${language} is not supported for this problem`);
    }

    const publicCount = problem.publicTests?.length ?? 0;
    const tests = await repo.getTestsForSubmit(uid, problem);

    const rawResult = await executeTests(
      sourceCode,
      language,
      tests,
      problem.timeLimitMs ?? 2000,
      problem.memoryLimitMb ?? 256,
      true
    );

    const sanitizedResults = sanitizeSubmitResults(rawResult.results, publicCount);
    const result: CodingRunResult = {
      ...rawResult,
      results: sanitizedResults,
    };

    const solved = result.verdict === "accepted" && result.passedCount === result.totalCount;
    const xpEarned = 0;
    const sourceHash = hashSourceCode(sourceCode);

    const submissionId = uuidv4();
    await repo.saveSubmission(uid, submissionId, {
      problemId,
      language,
      status: result.verdict,
      passed: solved,
      passedCount: result.passedCount,
      totalCount: result.totalCount,
      xpEarned,
      sourceHash,
      sourceCode,
      assessmentType: problem.assessmentType ?? "DSA",
      executionMode: problem.executionMode ?? "JUDGE0",
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

    const response: CodingSubmitResult = {
      ...result,
      xpEarned,
      solved,
      submissionId,
    };

    if (idempotencyKey) {
      await repo.saveIdempotentResult(
        uid,
        idempotencyKey,
        response as unknown as Record<string, unknown>
      );
    }

    return response;
  });
};

export const getSubmission = async (
  uid: string,
  submissionId: string
): Promise<Record<string, unknown>> => {
  const submission = await repo.getSubmissionById(uid, submissionId);
  if (!submission) {
    throw new AppError(404, "Submission not found");
  }

  // Never return full source via this endpoint to casual clients if we later widen access;
  // owner-only today — still omit sourceCode from list-style payloads, keep hash.
  const { sourceCode: _sourceCode, ...safe } = submission;
  return safe;
};
