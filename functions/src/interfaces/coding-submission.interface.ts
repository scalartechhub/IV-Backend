// Mirrors src/app/interfaces/coding-submission.interface.ts � keep in sync
import type { Timestamp } from 'firebase-admin/firestore';

export type SubmissionStatus = 'passed' | 'failed' | 'partial' | 'runtime_error';

export interface AiCodeReview {
  summary: string;
  suggestions: string[];
}

/** Path: interviews/{interviewId}/submissions/{submissionId} */
export interface CodingSubmission {
  problemId: string;
  code: string;
  language: string;
  submittedAt: Timestamp;
  status: SubmissionStatus;
  testsPassed: number;
  testsTotal: number;
  runtimeMs?: number;
  aiCodeReview?: AiCodeReview;
  /** Duplicated for security rules — architecture §3 */
  userId?: string;
}
