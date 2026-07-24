/**
 * Achievement evaluation service (shared by REST, callables, triggers).
 */

import { FieldValue } from 'firebase-admin/firestore';
import type { AchievementCatalogDoc } from '../interfaces/achievement.interface';
import type { UserDoc } from '../interfaces/user.interface';
import { ensureAdmin } from '../utils/callable-auth';
import {
  achievementsCatalogCol,
  notificationsCol,
  userAchievementRef,
} from '../utils/firestore-refs';
import { ensureUserDefaults } from './schema-defaults';

export interface CheckAchievementsOptions {
  overallScore?: number;
}

/** In-memory cache of the static achievements catalog across warm invocations. */
let catalogCache: Array<{ id: string; data: AchievementCatalogDoc }> | null =
  null;
let catalogCachedAt = 0;
const CATALOG_TTL_MS = 10 * 60 * 1000;

async function loadCatalog(): Promise<
  Array<{ id: string; data: AchievementCatalogDoc }>
> {
  const now = Date.now();
  if (catalogCache && now - catalogCachedAt < CATALOG_TTL_MS) {
    return catalogCache;
  }
  const db = ensureAdmin();
  const snap = await achievementsCatalogCol(db).get();
  catalogCache = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  catalogCachedAt = now;
  return catalogCache;
}

function ruleSatisfied(
  rule: AchievementCatalogDoc['rule'],
  user: UserDoc,
  opts?: CheckAchievementsOptions,
): boolean {
  switch (rule.type) {
    case 'streak_gte':
      return (user.gamification?.streakCount ?? 0) >= rule.value;
    case 'interviews_gte':
      return (user.stats?.totalInterviews ?? 0) >= rule.value;
    case 'problems_gte':
      return (user.stats?.problemsSolved ?? 0) >= rule.value;
    case 'score_gte':
      return (
        opts?.overallScore !== undefined && opts.overallScore >= rule.value
      );
    default:
      return false;
  }
}

/**
 * Evaluate catalog rules against the user doc; unlock newly satisfied achievements.
 * Pass overallScore from complete-interview for score_gte rules.
 */
export async function checkAchievements(
  uid: string,
  opts?: CheckAchievementsOptions,
): Promise<string[]> {
  const db = ensureAdmin();
  await ensureUserDefaults(db, uid);

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return [];

  const user = userSnap.data() as UserDoc;
  const catalog = await loadCatalog();
  const unlocked: string[] = [];

  for (const item of catalog) {
    if (!ruleSatisfied(item.data.rule, user, opts)) continue;

    const achRef = userAchievementRef(db, uid, item.id);
    const existing = await achRef.get();
    if (existing.exists) continue;

    await achRef.set({
      unlockedAt: FieldValue.serverTimestamp() as never,
      seen: false,
    });

    await notificationsCol(db, uid).add({
      type: 'achievement_unlocked',
      title: `Achievement unlocked: ${item.data.name}`,
      body: item.data.description,
      read: false,
      createdAt: FieldValue.serverTimestamp() as never,
      actionUrl: '/achievements',
      relatedId: item.id,
    });

    unlocked.push(item.id);
  }

  return unlocked;
}

/**
 * List catalog + which achievements the user has unlocked.
 */
export async function listAchievements(uid: string): Promise<{
  catalog: Array<{ id: string; data: AchievementCatalogDoc }>;
  unlocked: Array<{ id: string; unlockedAt: unknown; seen: boolean }>;
}> {
  const db = ensureAdmin();
  const catalog = await loadCatalog();
  const unlockedSnap = await db
    .collection('users')
    .doc(uid)
    .collection('achievements')
    .get();

  return {
    catalog,
    unlocked: unlockedSnap.docs.map((d) => ({
      id: d.id,
      unlockedAt: d.data().unlockedAt,
      seen: Boolean(d.data().seen),
    })),
  };
}
