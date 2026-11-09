// Legacy catalog shape for historical Firestore docs in codingProblems/{id}.
// Active practice assessments are AI-generated under
// users/{uid}/generatedCodingProblems — see modules/coding/coding.types.ts.
import type { Timestamp } from 'firebase-admin/firestore';

export type ProblemDifficulty = 'easy' | 'medium' | 'hard';
export type ProblemProgressStatus = 'unsolved' | 'solved' | 'attempted';

export interface CodingTestCase {
  input: string;
  expectedOutput: string;
  hidden: boolean;
}

/** @deprecated Prefer modules/coding/coding.types CodingProblemDoc (AI-generated). */
export interface CodingProblemDoc {
  title: string;
  category: string;
  difficulty: ProblemDifficulty;
  acceptanceRate: number;
  description: string;
  starterCode: Record<string, string>;
  testCases: CodingTestCase[];
  tags: string[];
}

/** @deprecated Prefer users/{uid}/codingProgress via CODING_SUBCOLLECTIONS.PROGRESS. */
export interface ProblemProgressDoc {
  status: ProblemProgressStatus;
  bestSubmissionId?: string;
  solvedAt?: Timestamp;
  attempts: number;
}
