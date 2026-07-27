/**
 * Ensure denormalized fields exist on user / interview docs (lazy init).
 */

import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type {
  UserGamification,
  UserProfile,
  UserReadiness,
} from '../interfaces/user.interface';
import { SKILL_IDS, DEFAULT_SKILL_SCORE } from '../library/skills';
import { skillRef, userRef } from '../utils/firestore-refs';

/**
 * Legacy (pre-v2) user docs are created by the auth module without the
 * gamification / readiness / profile blocks that v2 endpoints rely on —
 * backfill sane defaults so consumers never hit `undefined.field`.
 */
const DEFAULT_GAMIFICATION: UserGamification = {
  level: 1,
  levelName: 'Candidate',
  currentXP: 0,
  xpToNextLevel: 500,
  streakCount: 0,
  lastActiveDate: '',
  longestStreak: 0,
};

const DEFAULT_READINESS: Omit<UserReadiness, 'lastComputedAt'> = {
  score: 0,
  deltaWeek: 0,
  percentileVsRole: 0,
};

const DEFAULT_PROFILE: UserProfile = {
  currentRole: 'Software Developer',
  yearsExperience: 0,
  targetRole: 'Software Developer',
  targetCompanies: [],
  location: '',
};

function backfillNestedDefaults(
  updates: Record<string, unknown>,
  path: string,
  existing: Record<string, unknown> | undefined,
  defaults: Record<string, unknown>,
): void {
  if (!existing) {
    updates[path] = defaults;
    return;
  }
  for (const [key, value] of Object.entries(defaults)) {
    if (existing[key] === undefined) {
      updates[`${path}.${key}`] = value;
    }
  }
}

/**
 * Ensure users/{uid}.stats, .gamification, .readiness, .profile, and default
 * skill docs exist.
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

  backfillNestedDefaults(
    updates,
    'gamification',
    data.gamification as unknown as Record<string, unknown> | undefined,
    DEFAULT_GAMIFICATION as unknown as Record<string, unknown>,
  );
  backfillNestedDefaults(
    updates,
    'profile',
    data.profile as unknown as Record<string, unknown> | undefined,
    DEFAULT_PROFILE as unknown as Record<string, unknown>,
  );

  if (!data.readiness) {
    updates.readiness = {
      ...DEFAULT_READINESS,
      lastComputedAt: FieldValue.serverTimestamp(),
    };
  } else {
    const readiness = data.readiness as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(DEFAULT_READINESS)) {
      if (readiness[key] === undefined) {
        updates[`readiness.${key}`] = value;
      }
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
