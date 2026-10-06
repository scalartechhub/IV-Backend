/**
 * ============================================================================
 * UNUSED / DUMMY FUNCTION — NOT IN ACTIVE USE
 * ============================================================================
 * Note: This function is dummy / not used in the application and is not going
 * to be used. It has been commented out from functions/src/index.ts.
 * Interview completion and scoring are handled directly inside interview.service
 * via the Express REST API.
 * ============================================================================
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import type { InterviewResults } from '../interfaces/interview.interface';
import { checkAchievements } from '../services/achievement.service';
import { withTeamsAlert } from '../shared/with-teams-alert';

export const onInterviewComplete = onDocumentUpdated(
  {
    document: 'interviews/{interviewId}',
    region: 'us-central1',
  },
  withTeamsAlert('onInterviewComplete', async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (before.status === 'completed' || after.status !== 'completed') return;

    const userId = after.userId as string | undefined;
    if (!userId) return;

    // completeInterview writes xpEarned + results — skip duplicate evaluation.
    if (typeof after.xpEarned === 'number' && after.results) {
      return;
    }

    const results = after.results as InterviewResults | undefined;

    await checkAchievements(userId, {
      completed: true,
      overallScore: results?.overallScore,
      success: (results?.overallScore ?? 0) >= 70,
      deliveryScore: results?.communicationScore,
      contentScore: results?.technicalScore,
      skillScores: results
        ? {
            technical: results.technicalScore,
            communication: results.communicationScore,
            confidence: results.confidenceScore,
            problemSolving: results.problemSolvingScore,
            behavior: results.behaviorScore ?? 0,
          }
        : undefined,
    });
  }),
);
