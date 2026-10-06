/**
 * ============================================================================
 * UNUSED / DUMMY FUNCTION — NOT IN ACTIVE USE
 * ============================================================================
 * Note: This function is dummy / not used in the application and is not going
 * to be used. It has been commented out from functions/src/index.ts.
 * Achievement checks are handled directly within the service layer.
 * ============================================================================
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { checkAchievements } from '../services/achievement.service';
import { withTeamsAlert } from '../shared/with-teams-alert';

export { checkAchievements } from '../services/achievement.service';

export const onAchievementCheck = onDocumentUpdated(
  {
    document: 'users/{uid}',
    region: 'us-central1',
  },
  withTeamsAlert('onAchievementCheck', async (event) => {
    const uid = event.params.uid;
    if (!uid) return;
    await checkAchievements(uid);
  }),
);
