/**
 * Skill score EMA updates after an interview.
 */

import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { SkillId } from '../interfaces/user.interface';
import { skillRef } from '../utils/firestore-refs';

export const SKILL_IDS: readonly SkillId[] = [
  'technical',
  'communication',
  'confidence',
  'problemSolving',
  'coding',
  'behavior',
] as const;

export const DEFAULT_SKILL_SCORE = 50;
export const EMA_PREV_WEIGHT = 0.85;
export const EMA_NEW_WEIGHT = 0.15;

export function clampScore(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Apply EMA smoothing: newScore = round(prev * 0.85 + raw * 0.15)
 * where raw = clamp(prev + delta, 0, 100).
 */
export function applySkillDelta(prevScore: number, delta: number): number {
  const prev = Number.isFinite(prevScore) ? prevScore : DEFAULT_SKILL_SCORE;
  const raw = clampScore(prev + delta);
  return Math.round(prev * EMA_PREV_WEIGHT + raw * EMA_NEW_WEIGHT);
}

export type SkillScoreMap = Record<SkillId, number>;

/**
 * Compute updated scores for all six skills given deltas (missing keys treated as 0).
 */
export function updateSkillScores(
  current: Partial<SkillScoreMap>,
  deltas: Record<string, number>,
): SkillScoreMap {
  const result = {} as SkillScoreMap;
  for (const id of SKILL_IDS) {
    const prev = current[id] ?? DEFAULT_SKILL_SCORE;
    const delta = deltas[id] ?? 0;
    result[id] = applySkillDelta(prev, delta);
  }
  return result;
}

/**
 * Persist EMA-smoothed skill scores and increment deltaThisWeek inside a transaction.
 * All skill docs are read before any writes (Firestore transaction rule).
 */
export async function updateSkills(
  tx: Transaction,
  db: Firestore,
  uid: string,
  skillDeltas: Record<string, number>,
): Promise<SkillScoreMap> {
  const snaps = await Promise.all(
    SKILL_IDS.map((id) => tx.get(skillRef(db, uid, id))),
  );

  const current = {} as Partial<SkillScoreMap>;
  for (let i = 0; i < SKILL_IDS.length; i++) {
    const id = SKILL_IDS[i];
    const snap = snaps[i];
    current[id] =
      snap.exists && typeof snap.data()?.score === 'number'
        ? (snap.data()!.score as number)
        : DEFAULT_SKILL_SCORE;
  }

  return writeSkillUpdates(tx, db, uid, current as SkillScoreMap, skillDeltas);
}

/**
 * Write skill updates from already-read current scores (no tx.get — safe after other writes).
 */
export function writeSkillUpdates(
  tx: Transaction,
  db: Firestore,
  uid: string,
  current: SkillScoreMap,
  skillDeltas: Record<string, number>,
): SkillScoreMap {
  const updated = updateSkillScores(current, skillDeltas);
  for (const id of SKILL_IDS) {
    tx.set(
      skillRef(db, uid, id),
      {
        score: updated[id],
        deltaThisWeek: FieldValue.increment(skillDeltas[id] ?? 0),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  return updated;
}
