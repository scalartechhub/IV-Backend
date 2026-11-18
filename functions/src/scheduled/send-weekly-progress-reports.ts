/**
 * Scheduled Cron Function: Runs every Sunday at 18:00 UTC.
 * Sends a weekly interview, learning roadmap, and activity progress report
 * to all active users who have weekly progress emails enabled in their preferences.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { withTeamsAlert } from '../shared/with-teams-alert';
import { sendWeeklyProgressReportsToAllUsers } from '../services/weekly-report-email.service';

export const sendWeeklyProgressReports = onSchedule(
  {
    schedule: 'every sunday 18:00',
    timeZone: 'UTC',
    region: 'us-central1',
    memory: '1GiB',
    timeoutSeconds: 540,
  },
  withTeamsAlert('sendWeeklyProgressReports', async () => {
    await sendWeeklyProgressReportsToAllUsers({ dryRun: false });
  }),
);
