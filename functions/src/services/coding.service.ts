/**
 * V2 coding submission service — sandboxed runner via CODE_RUNNER_URL.
 */

import { FieldValue } from 'firebase-admin/firestore';
import type { SubmissionStatus } from '../interfaces/coding-submission.interface';
import type { ProblemProgressStatus } from '../interfaces/coding-problem.interface';
import { AppError } from '../shared/utils';
import { ensureAdmin } from '../utils/callable-auth';
import {
  codingProblemRef,
  interviewRef,
  problemProgressRef,
  submissionsCol,
  userRef,
} from '../utils/firestore-refs';
import { ensureUserDefaults } from './schema-defaults';

export interface SubmitCodingInput {
  interviewId: string;
  problemId: string;
  code: string;
  language: string;
}

export interface SubmitCodingResult {
  submissionId: string;
  testsPassed: number;
  testsTotal: number;
  status: SubmissionStatus;
}

interface SandboxResult {
  testsPassed: number;
  testsTotal: number;
  runtimeMs?: number;
  error?: string;
}

async function runInSandbox(params: {
  code: string;
  language: string;
  testCases: Array<{ input: string; expectedOutput: string; hidden: boolean }>;
}): Promise<SandboxResult> {
  const runnerUrl = process.env.CODE_RUNNER_URL;
  if (!runnerUrl) {
    console.warn(
      '[codingService] CODE_RUNNER_URL unset; returning stubbed results',
    );
    return {
      testsPassed: 0,
      testsTotal: params.testCases.length,
      error: 'CODE_RUNNER_URL not configured',
    };
  }

  const res = await fetch(runnerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw new AppError(502, `Code runner failed with status ${res.status}`);
  }

  return (await res.json()) as SandboxResult;
}

function deriveStatus(
  passed: number,
  total: number,
  error?: string,
): SubmissionStatus {
  if (error && passed === 0) return 'runtime_error';
  if (total > 0 && passed === total) return 'passed';
  if (passed === 0) return 'failed';
  return 'partial';
}

export async function submitCodingSolution(
  uid: string,
  input: SubmitCodingInput,
): Promise<SubmitCodingResult> {
  const db = ensureAdmin();
  await ensureUserDefaults(db, uid);

  const { interviewId, problemId, code, language } = input;

  const interviewSnap = await interviewRef(db, interviewId).get();
  if (!interviewSnap.exists || interviewSnap.data()!.userId !== uid) {
    throw new AppError(403, 'Interview not found or not owned by user.');
  }

  const problemSnap = await codingProblemRef(db, problemId).get();
  if (!problemSnap.exists) {
    throw new AppError(404, 'Coding problem not found.');
  }
  const problem = problemSnap.data()!;

  const sandbox = await runInSandbox({
    code,
    language,
    testCases: problem.testCases,
  });

  const status = deriveStatus(
    sandbox.testsPassed,
    sandbox.testsTotal,
    sandbox.error,
  );

  const submissionRef = submissionsCol(db, interviewId).doc();
  await submissionRef.set({
    problemId,
    code,
    language,
    submittedAt: FieldValue.serverTimestamp() as never,
    status,
    testsPassed: sandbox.testsPassed,
    testsTotal: sandbox.testsTotal,
    runtimeMs: sandbox.runtimeMs,
    userId: uid,
  });

  const progressStatus: ProblemProgressStatus =
    status === 'passed' ? 'solved' : 'attempted';

  await db.runTransaction(async (tx) => {
    const progressRef = problemProgressRef(db, uid, problemId);
    const progressSnap = await tx.get(progressRef);
    const attempts =
      (progressSnap.exists ? progressSnap.data()?.attempts ?? 0 : 0) + 1;

    tx.set(
      progressRef,
      {
        status: progressStatus,
        bestSubmissionId:
          status === 'passed'
            ? submissionRef.id
            : progressSnap.data()?.bestSubmissionId,
        ...(status === 'passed'
          ? { solvedAt: FieldValue.serverTimestamp() }
          : {}),
        attempts,
      },
      { merge: true },
    );

    if (status === 'passed') {
      tx.update(userRef(db, uid), {
        'stats.problemsSolved': FieldValue.increment(1),
      });
    }

    const interview = interviewSnap.data()!;
    const codingData = interview.codingData ?? {
      problemIds: [],
      submissionIds: [],
      passRate: 0,
    };
    const submissionIds = [...codingData.submissionIds, submissionRef.id];
    const problemIds = codingData.problemIds.includes(problemId)
      ? codingData.problemIds
      : [...codingData.problemIds, problemId];

    tx.update(interviewRef(db, interviewId), {
      codingData: {
        problemIds,
        submissionIds,
        passRate:
          sandbox.testsTotal > 0
            ? sandbox.testsPassed / sandbox.testsTotal
            : 0,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    submissionId: submissionRef.id,
    testsPassed: sandbox.testsPassed,
    testsTotal: sandbox.testsTotal,
    status,
  };
}
