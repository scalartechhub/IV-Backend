// Mirrors src/app/interfaces/job.interface.ts — keep in sync
import type { Timestamp } from 'firebase-admin/firestore';

export type ApplicationStatus =
  | 'saved'
  | 'applied'
  | 'interviewing'
  | 'offer'
  | 'rejected';

/** Path: jobListings/{jobId} */
export interface JobListingDoc {
  company: string;
  role: string;
  location: string;
  salaryMin: number;
  salaryMax: number;
  currency: string;
  remote: boolean;
  requiredSkills: string[];
  postedAt: Timestamp;
  active: boolean;
}

/** Path: users/{uid}/jobMatches/{jobId} */
export interface JobMatchDoc {
  matchPercent: number;
  matchedSkills: string[];
  computedAt: Timestamp;
}

/** Path: users/{uid}/applications/{applicationId} */
export interface ApplicationDoc {
  jobId: string;
  status: ApplicationStatus;
  appliedAt?: Timestamp;
  notifyOnLaunch: boolean;
}
