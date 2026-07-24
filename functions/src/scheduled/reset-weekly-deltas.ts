/**
 * Scheduled: every Monday 00:00 UTC — zero deltaThisWeek on all skill docs.
 */

import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { ensureAdmin } from '../utils/callable-auth';

const BATCH_SIZE = 500;

/**
 * Paginated batch-zero of users/{uid}/skills/{skillId}.deltaThisWeek.
 */
export const resetWeeklyDeltas = onSchedule(
  {
    schedule: 'every monday 00:00',
    timeZone: 'UTC',
    region: 'us-central1',
    memory: '1GiB',
    timeoutSeconds: 540,
  },
  async () => {
    const db = ensureAdmin();
    let lastDoc: QueryDocumentSnapshot | undefined;

    for (;;) {
      let query = db
        .collectionGroup('skills')
        .orderBy('__name__')
        .limit(BATCH_SIZE);
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }
      const snap = await query.get();
      if (snap.empty) break;

      const batch = db.batch();
      for (const doc of snap.docs) {
        batch.update(doc.ref, { deltaThisWeek: 0 });
      }
      await batch.commit();

      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < BATCH_SIZE) break;
    }
  },
);
