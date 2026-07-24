/**
 * Scheduled: nightly job matching — users/{uid}/jobMatches/{jobId}.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { JobMatchDoc } from '../interfaces/job.interface';
import { ensureAdmin } from '../utils/callable-auth';
import { jobListingsCol, jobMatchRef } from '../utils/firestore-refs';

function matchPercent(
  userSkills: string[],
  required: string[],
): { percent: number; matched: string[] } {
  if (required.length === 0) return { percent: 0, matched: [] };
  const set = new Set(userSkills.map((s) => s.toLowerCase()));
  const matched = required.filter((r) => set.has(r.toLowerCase()));
  return {
    percent: Math.round((matched.length / required.length) * 100),
    matched,
  };
}

/**
 * For each active user, score against active job listings and write top matches.
 */
export const computeJobMatches = onSchedule(
  {
    schedule: 'every day 02:30',
    timeZone: 'UTC',
    region: 'us-central1',
    memory: '1GiB',
    timeoutSeconds: 540,
  },
  async () => {
    const db = ensureAdmin();
    const listingsSnap = await jobListingsCol(db)
      .where('active', '==', true)
      .limit(200)
      .get();

    const listings = listingsSnap.docs.map((d) => ({
      id: d.id,
      data: d.data(),
    }));
    if (listings.length === 0) return;

    const usersSnap = await db
      .collection('users')
      .select('profile')
      .limit(1000)
      .get();

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const profile = userDoc.data().profile as
        | { targetRole?: string; targetCompanies?: string[] }
        | undefined;

      // Gather skill names from skills subcollection + profile signals
      const skillsSnap = await db
        .collection('users')
        .doc(uid)
        .collection('skills')
        .get();
      const userSkills = [
        ...skillsSnap.docs.map((d) => d.id),
        profile?.targetRole ?? '',
        ...(profile?.targetCompanies ?? []),
      ].filter(Boolean);

      for (const listing of listings) {
        const { percent, matched } = matchPercent(
          userSkills,
          listing.data.requiredSkills ?? [],
        );
        if (percent < 40) continue;

        const doc: JobMatchDoc = {
          matchPercent: percent,
          matchedSkills: matched,
          computedAt: FieldValue.serverTimestamp() as never,
        };
        await jobMatchRef(db, uid, listing.id).set(doc);
      }
    }
  },
);
