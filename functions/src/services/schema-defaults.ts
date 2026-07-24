/**
 * Ensure denormalized fields exist on user / interview docs (lazy init).
 */

import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { SKILL_IDS, DEFAULT_SKILL_SCORE } from '../library/skills';
import { skillRef, userRef } from '../utils/firestore-refs';

/**
 * Ensure users/{uid}.stats and default skill docs exist.
 */
export async function ensureUserDefaults(
  db: Firestore,
  uid: string,
): Promise<void> {
  const ref = userRef(db, uid);
  const snap = await ref.get();
  if (!snap.exists) return;

  const data = snap.data()!;
  const updates: Record<string, unknown> = {};

  if (!data.stats) {
    updates['stats.totalInterviews'] = 0;
    updates['stats.problemsSolved'] = 0;
  } else {
    if (typeof data.stats.totalInterviews !== 'number') {
      updates['stats.totalInterviews'] = 0;
    }
    if (typeof data.stats.problemsSolved !== 'number') {
      updates['stats.problemsSolved'] = 0;
    }
  }

  if (Object.keys(updates).length > 0) {
    await ref.update(updates);
  }

  const batch = db.batch();
  let writes = 0;
  for (const id of SKILL_IDS) {
    const sRef = skillRef(db, uid, id);
    const sSnap = await sRef.get();
    if (!sSnap.exists) {
      batch.set(sRef, {
        score: DEFAULT_SKILL_SCORE,
        deltaThisWeek: 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
      writes += 1;
    }
  }
  if (writes > 0) {
    await batch.commit();
  }
}
