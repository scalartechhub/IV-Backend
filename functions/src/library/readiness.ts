/**
 * Interview readiness score from weighted skill scores.
 */

import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { SkillId } from '../interfaces/user.interface';
import { userRef } from '../utils/firestore-refs';
import { SKILL_IDS, type SkillScoreMap } from './skills';

export const READINESS_WEIGHTS: Record<SkillId, number> = {
  technical: 0.25,
  coding: 0.2,
  problemSolving: 0.2,
  communication: 0.15,
  confidence: 0.1,
  behavior: 0.1,
};

/**
 * readinessScore = round(sum(skills[k].score * WEIGHTS[k]) / sum(used weights)).
 * Untested skills are omitted — do not pad with the EMA default of 50.
 */
export function calculateReadiness(skills: Partial<SkillScoreMap>): number {
  let sum = 0;
  let weight = 0;
  for (const id of SKILL_IDS) {
    const score = skills[id];
    if (typeof score !== 'number' || !Number.isFinite(score)) continue;
    const w = READINESS_WEIGHTS[id];
    sum += score * w;
    weight += w;
  }
  if (weight <= 0) return 0;
  return Math.round(sum / weight);
}

/**
 * Week-over-week delta given current readiness and a snapshot from ~7 days ago.
 */
export function calculateReadinessDeltaWeek(
  current: number,
  score7dAgo: number | undefined,
): number {
  if (score7dAgo === undefined || !Number.isFinite(score7dAgo)) {
    return 0;
  }
  return current - score7dAgo;
}

/**
 * Write readiness.score + deltaWeek onto users/{uid}.
 */
export function writeReadiness(
  tx: Transaction,
  db: Firestore,
  uid: string,
  skills: Partial<SkillScoreMap>,
  score7dAgo: number | undefined,
): { readinessScore: number; deltaWeek: number } {
  const readinessScore = calculateReadiness(skills);
  const deltaWeek = calculateReadinessDeltaWeek(readinessScore, score7dAgo);

  tx.update(userRef(db, uid), {
    'readiness.score': readinessScore,
    'readiness.deltaWeek': deltaWeek,
    'readiness.lastComputedAt': FieldValue.serverTimestamp(),
  });

  return { readinessScore, deltaWeek };
}
