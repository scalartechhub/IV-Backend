/**
 * Achievement evaluation — reads master catalog `achievements/{id}` (metric/targetValue)
 * and writes progress to `users/{uid}/achievements/{id}` in the frontend-compatible shape.
 */

import { FieldValue } from 'firebase-admin/firestore';
import type {
  AchievementDoc,
  AchievementMetric,
  UserAchievementDoc,
} from '../interfaces/achievement.interface';
import type { UserDoc } from '../interfaces/user.interface';
import { ensureAdmin } from '../utils/callable-auth';
import {
  achievementsCol,
  notificationsCol,
  userAchievementRef,
  userRef,
} from '../utils/firestore-refs';
import { ensureUserDefaults } from './schema-defaults';

export interface CheckAchievementsOptions {
  overallScore?: number;
  xpEarned?: number;
  completed?: boolean;
  success?: boolean;
  deliveryScore?: number;
  contentScore?: number;
  scoreImprovement?: number;
  skillScores?: Partial<{
    technical: number;
    communication: number;
    confidence: number;
    problemSolving: number;
    behavior: number;
  }>;
}

interface CatalogItem {
  id: string;
  data: AchievementDoc;
}

interface ProgressSnapshot {
  unlocked: boolean;
  currentValue: number;
  unlockedAt: UserAchievementDoc['unlockedAt'] | null;
}

/** In-memory cache of the static achievements catalog across warm invocations. */
let catalogCache: CatalogItem[] | null = null;
let catalogCachedAt = 0;
const CATALOG_TTL_MS = 10 * 60 * 1000;

async function loadCatalog(): Promise<CatalogItem[]> {
  const now = Date.now();
  if (catalogCache && now - catalogCachedAt < CATALOG_TTL_MS) {
    return catalogCache;
  }
  const db = ensureAdmin();
  const snap = await achievementsCol(db).get();
  catalogCache = snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter((item) => item.data.isActive !== false);
  catalogCachedAt = now;
  return catalogCache;
}

function readProgress(raw: Partial<UserAchievementDoc> | undefined): ProgressSnapshot {
  if (!raw) {
    return { unlocked: false, currentValue: 0, unlockedAt: null };
  }
  // Support legacy docs that only had unlockedAt/seen
  const unlocked =
    raw.unlocked === true ||
    (raw.unlockedAt != null && raw.unlocked !== false);
  return {
    unlocked,
    currentValue: typeof raw.currentValue === 'number' ? raw.currentValue : unlocked ? 1 : 0,
    unlockedAt: raw.unlockedAt ?? null,
  };
}

/** Exported for unit testing — pure function, no Firestore access. */
export function computeMetricValue(
  metric: AchievementMetric,
  previousValue: number,
  user: UserDoc,
  opts: CheckAchievementsOptions,
): number {
  const interviews = user.stats?.totalInterviews ?? 0;
  const streak = user.gamification?.streakCount ?? 0;
  const overall = opts.overallScore ?? 0;

  switch (metric) {
    case 'interviews_completed':
      return interviews;
    case 'successful_interviews':
      // Absolute counter — safe if checkAchievements runs more than once
      return user.stats?.successfulInterviews ?? previousValue;
    case 'streak_days':
      return streak;
    case 'highest_score':
      return Math.max(previousValue, overall);
    case 'delivery_score':
      return Math.max(
        previousValue,
        opts.deliveryScore ?? opts.skillScores?.communication ?? 0,
      );
    case 'content_score':
      return Math.max(
        previousValue,
        opts.contentScore ?? opts.skillScores?.technical ?? overall,
      );
    case 'communication_score':
      return Math.max(
        previousValue,
        opts.skillScores?.communication ?? opts.deliveryScore ?? 0,
      );
    case 'confidence_score':
      return Math.max(previousValue, opts.skillScores?.confidence ?? 0);
    case 'problem_solving_score':
      return Math.max(previousValue, opts.skillScores?.problemSolving ?? 0);
    case 'technical_score':
      return Math.max(previousValue, opts.skillScores?.technical ?? 0);
    case 'behavior_score':
      return Math.max(previousValue, opts.skillScores?.behavior ?? 0);
    case 'score_improvement':
      return Math.max(previousValue, opts.scoreImprovement ?? 0);
    case 'problems_solved':
      return user.stats?.problemsSolved ?? previousValue;
    case 'resume_analysis_completed':
      return user.resumeAnalysisCompleted ? 1 : previousValue;
    case 'roadmap_weeks_completed':
      return user.stats?.roadmapWeeksCompleted ?? previousValue;
    default:
      return previousValue;
  }
}

/**
 * Evaluate active catalog metrics against the user + latest interview signals.
 * Writes progress docs matching the frontend `UserAchievementProgress` shape.
 */
export async function checkAchievements(
  uid: string,
  opts: CheckAchievementsOptions = {},
): Promise<string[]> {
  const db = ensureAdmin();
  await ensureUserDefaults(db, uid);

  const userSnap = await userRef(db, uid).get();
  if (!userSnap.exists) return [];

  const user = userSnap.data()!;
  const catalog = await loadCatalog();
  const newlyUnlocked: string[] = [];

  const progressSnaps = await Promise.all(
    catalog.map((item) => userAchievementRef(db, uid, item.id).get()),
  );

  const batch = db.batch();
  let writes = 0;

  for (let i = 0; i < catalog.length; i++) {
    const item = catalog[i];
    const existingSnap = progressSnaps[i];
    const previous = readProgress(
      existingSnap.exists ? (existingSnap.data() as UserAchievementDoc) : undefined,
    );

    const nextValue = computeMetricValue(
      item.data.metric,
      previous.currentValue,
      user,
      opts,
    );
    const unlocked =
      previous.unlocked || nextValue >= (item.data.targetValue ?? 1);

    if (!previous.unlocked && !unlocked && nextValue <= 0) {
      continue;
    }

    if (
      previous.unlocked === unlocked &&
      previous.currentValue === nextValue
    ) {
      continue;
    }

    const achRef = userAchievementRef(db, uid, item.id);
    batch.set(
      achRef,
      {
        achievementId: item.id,
        unlocked,
        unlockedAt: unlocked
          ? previous.unlockedAt ?? (FieldValue.serverTimestamp() as never)
          : null,
        currentValue: nextValue,
        updatedAt: FieldValue.serverTimestamp() as never,
      },
      { merge: true },
    );
    writes += 1;

    if (unlocked && !previous.unlocked) {
      newlyUnlocked.push(item.id);
      batch.set(notificationsCol(db, uid).doc(), {
        type: 'achievement_unlocked',
        title: `Achievement unlocked: ${item.data.name}`,
        body: item.data.description,
        read: false,
        createdAt: FieldValue.serverTimestamp() as never,
        actionUrl: '/achievements',
        relatedId: item.id,
      });
      writes += 1;
    }
  }

  if (newlyUnlocked.length > 0) {
    batch.set(
      userRef(db, uid),
      {
        totalAchievements: FieldValue.increment(newlyUnlocked.length),
        updatedAt: FieldValue.serverTimestamp(),
      } as never,
      { merge: true },
    );
    writes += 1;
  }

  if (writes > 0) {
    await batch.commit();
  }

  return newlyUnlocked;
}

/**
 * List catalog + per-user progress for REST clients.
 */
export async function listAchievements(uid: string): Promise<{
  catalog: CatalogItem[];
  progress: Array<{ id: string } & Partial<UserAchievementDoc>>;
}> {
  const db = ensureAdmin();
  const catalog = await loadCatalog();
  const progressSnap = await db
    .collection('users')
    .doc(uid)
    .collection('achievements')
    .get();

  return {
    catalog,
    progress: progressSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as UserAchievementDoc),
    })),
  };
}
