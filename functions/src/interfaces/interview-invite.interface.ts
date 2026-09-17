import type { Timestamp } from 'firebase-admin/firestore';

export type InterviewInviteStatus =
  | 'pending'
  | 'started'
  | 'completed'
  | 'expired'
  | 'cancelled';

/** Snapshot of the JD captured at invite creation time.
 *  Stored so that admin edits to the original JD do not affect an in-progress interview. */
export interface JdSnapshot {
  title: string;
  companyName: string;
  requiredSkills: string[];
  preferredSkills?: string[];
  keyResponsibilities: string[];
  requiredQualifications: string[];
  jobSummary?: string;
}

/** Path: interviewInvites/{inviteId} */
export interface InterviewInviteDoc {
  id: string;
  /** SHA-256 hash of the invitation token — never store the raw token */
  tokenHash: string;
  /** ID of the source job-description document in `jobDescription` collection */
  jdId: string;
  /** JD snapshot captured at creation time */
  jdSnapshot: JdSnapshot;
  candidateName: string;
  candidateEmail: string;
  /** Maps to InterviewMode in interview.interface */
  interviewType: string;
  durationMinutes: number;
  difficulty: 'easy' | 'medium' | 'hard';
  /** UID of the admin who created this invite */
  createdBy: string;
  status: InterviewInviteStatus;
  createdAt: Timestamp;
  /** Optional — if set, invite becomes invalid after this timestamp */
  expiresAt?: Timestamp;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  /** ID of the interview document created when the candidate started */
  interviewId?: string;
  /** Firebase UID of the anonymous candidate user */
  candidateUid?: string;
}
