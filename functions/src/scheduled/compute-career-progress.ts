/**
 * Scheduled: nightly peer benchmarking → users/{uid}/careerProgress/current.
 * TODO: migrate to BigQuery at scale (Firestore export extension).
 */

import { FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { CareerProgressDoc } from '../interfaces/career-progress.interface';
import { ensureAdmin } from '../utils/callable-auth';
import { careerProgressRef } from '../utils/firestore-refs';
import { daysAgo } from '../utils/date-helpers';

const SKILL_KEYS = [
  'technical',
  'communication',
  'confidence',
  'problemSolving',
  'coding',
  'behavior',
] as const;

/**
 * Batch users by profile.targetRole cohort; write peer averages for last 30 days.
 */
export const computeCareerProgress = onSchedule(
  {
    schedule: 'every day 02:00',
    timeZone: 'UTC',
    region: 'us-central1',
    memory: '1GiB',
    timeoutSeconds: 540,
  },
  async () => {
    const db = ensureAdmin();
    const since = daysAgo(30);

    // Cohort map: targetRole → { skill sums, counts, uids }
    const cohorts = new Map<
      string,
      {
        uids: string[];
        skillSums: Record<string, number>;
        skillCounts: Record<string, number>;
      }
    >();

    const usersSnap = await db.collection('users').select('profile', 'readiness').get();

    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      const role = (data.profile?.targetRole as string | undefined) ?? 'General';
      if (!cohorts.has(role)) {
        cohorts.set(role, {
          uids: [],
          skillSums: {},
          skillCounts: {},
        });
      }
      cohorts.get(role)!.uids.push(userDoc.id);
    }

    // Aggregate recent interview skill scores per cohort
    // TODO: migrate to BigQuery at scale
    for (const [role, cohort] of cohorts) {
      const interviewsSnap = await db
        .collection('interviews')
        .where('status', '==', 'completed')
        .where('completedAt', '>=', since)
        .where('config.targetRole', '==', role)
        .limit(500)
        .get()
        .catch(async () => {
          // Fallback if composite index missing: filter in memory (dev only)
          const all = await db
            .collection('interviews')
            .where('status', '==', 'completed')
            .where('completedAt', '>=', since)
            .limit(500)
            .get();
          return {
            docs: all.docs.filter(
              (d) => d.data().config?.targetRole === role,
            ),
          };
        });

      for (const doc of interviewsSnap.docs) {
        const results = doc.data().results as
          | Record<string, number>
          | undefined;
        if (!results) continue;
        for (const key of SKILL_KEYS) {
          const scoreKey = `${key}Score` as const;
          const val =
            typeof results[scoreKey] === 'number'
              ? results[scoreKey]
              : undefined;
          if (val === undefined) continue;
          cohort.skillSums[key] = (cohort.skillSums[key] ?? 0) + val;
          cohort.skillCounts[key] = (cohort.skillCounts[key] ?? 0) + 1;
        }
      }

      const peerAvg: Record<string, number> = {};
      for (const key of SKILL_KEYS) {
        const count = cohort.skillCounts[key] ?? 0;
        peerAvg[key] =
          count > 0
            ? Math.round((cohort.skillSums[key] ?? 0) / count)
            : 50;
      }

      for (const uid of cohort.uids) {
        const skillsSnap = await db
          .collection('users')
          .doc(uid)
          .collection('skills')
          .get();
        const you: Record<string, number> = {};
        for (const s of skillsSnap.docs) {
          you[s.id] = (s.data().score as number) ?? 50;
        }

        const scores: CareerProgressDoc['peerBenchmark']['scores'] = {};
        for (const key of SKILL_KEYS) {
          scores[key] = {
            you: you[key] ?? 50,
            peerAvg: peerAvg[key] ?? 50,
          };
        }

        const progress: CareerProgressDoc = {
          salaryInsights: {
            currency: 'INR',
            expectedRangeMin: 1_800_000,
            expectedRangeMax: 2_200_000,
            positionInRange: 0.5,
            mostRequestedSkill: 'Angular',
            fastestImprovingSkill: { name: 'communication', deltaPercent: 0 },
          },
          peerBenchmark: {
            cohortLabel: `${role} cohort`,
            cohortSize: cohort.uids.length,
            scores,
          },
          milestones: [
            {
              id: 'interviews_5',
              title: 'Complete 5 interviews',
              targetValue: 5,
              currentValue: 0,
              unlocksLevel: 'Developer',
            },
          ],
          lastComputedAt: FieldValue.serverTimestamp() as never,
        };

        await careerProgressRef(db, uid).set(progress, { merge: true });
      }
    }
  },
);
