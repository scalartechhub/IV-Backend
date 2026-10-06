/**
 * Scheduled Cron Function: Runs every day at 02:00 UTC.
 * Recomputes cohort peer averages across all users by target role
 * and updates users/{uid}/careerProgress/current peer benchmarks.
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
