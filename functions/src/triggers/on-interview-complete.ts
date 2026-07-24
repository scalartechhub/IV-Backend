/**
 * Trigger: when interview status flips to completed — safety-net achievement check.
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { checkAchievements } from '../services/achievement.service';

export const onInterviewComplete = onDocumentUpdated(
  {
    document: 'interviews/{interviewId}',
    region: 'us-central1',
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (before.status === 'completed' || after.status !== 'completed') return;

    const userId = after.userId as string | undefined;
    if (!userId) return;

    const overallScore = (after.results as { overallScore?: number } | undefined)
      ?.overallScore;
    await checkAchievements(userId, { overallScore });
  },
);
