/**
 * Trigger: on users/{uid} update — re-check streak/interview/problem achievements.
 * score_gte is handled via targeted checkAchievements(uid, { overallScore }) from complete.
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { checkAchievements } from '../services/achievement.service';

export { checkAchievements } from '../services/achievement.service';

export const onAchievementCheck = onDocumentUpdated(
  {
    document: 'users/{uid}',
    region: 'us-central1',
  },
  async (event) => {
    const uid = event.params.uid;
    if (!uid) return;
    await checkAchievements(uid);
  },
);
