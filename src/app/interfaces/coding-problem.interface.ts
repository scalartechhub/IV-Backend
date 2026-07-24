import type { Timestamp } from 'firebase/firestore';

export type ProblemDifficulty = 'easy' | 'medium' | 'hard';
export type ProblemProgressStatus = 'unsolved' | 'solved' | 'attempted';

export interface CodingTestCase {
  input: string;
  expectedOutput: string;
  hidden: boolean;
}

/** Path: codingProblems/{problemId} */
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

/** Path: users/{uid}/problemProgress/{problemId} */
export interface ProblemProgressDoc {
  status: ProblemProgressStatus;
  bestSubmissionId?: string;
  solvedAt?: Timestamp;
  attempts: number;
}
