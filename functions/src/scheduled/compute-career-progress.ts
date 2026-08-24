/**
 * Scheduled: nightly peer benchmarking → users/{uid}/careerProgress/current.
 * TODO: migrate to BigQuery at scale (Firestore export extension).
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { computeCareerProgressForAllUsers } from '../services/career-progress.service';
import { withTeamsAlert } from '../shared/with-teams-alert';

export const computeCareerProgress = onSchedule(
  {
    schedule: 'every day 02:00',
    timeZone: 'UTC',
    region: 'us-central1',
    memory: '1GiB',
    timeoutSeconds: 540,
  },
  withTeamsAlert('computeCareerProgress', async () => {
    await computeCareerProgressForAllUsers();
  }),
);
