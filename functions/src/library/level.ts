/**
 * XP → level resolution with hardcoded thresholds.
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';

export interface LevelThreshold {
  level: number;
  name: string;
  minXP: number;
}

export const LEVELS: readonly LevelThreshold[] = [
  { level: 1, name: 'Candidate', minXP: 0 },
  { level: 2, name: 'Developer', minXP: 500 },
  { level: 3, name: 'Senior Developer', minXP: 2000 },
  { level: 4, name: 'Lead', minXP: 5000 },
  { level: 5, name: 'Architect', minXP: 10000 },
] as const;

export interface LevelResolution {
  level: number;
  levelName: string;
  xpToNextLevel: number;
}

/**
 * Resolve level from total XP. xpToNextLevel = nextThreshold - newXP, or 0 at max.
 */
export function resolveLevel(newXP: number): LevelResolution {
  const xp = Number.isFinite(newXP) && newXP > 0 ? newXP : 0;
  let current = LEVELS[0];

  for (const threshold of LEVELS) {
    if (xp >= threshold.minXP) {
      current = threshold;
    } else {
      break;
    }
  }

  const next = LEVELS.find((l) => l.level === current.level + 1);
  const xpToNextLevel = next ? next.minXP - xp : 0;

  return {
    level: current.level,
    levelName: current.name,
    xpToNextLevel: Math.max(0, xpToNextLevel),
  };
}

/**
 * Leveling has been disabled app-wide — this is now a no-op that freezes the user at
 * whatever level they were already on (no Firestore writes, no level_up notifications).
 * Kept as a no-op (rather than removed from call sites) so callers keep compiling.
 */
export function applyLevelUpdate(
  _tx: Transaction,
  _db: Firestore,
  _uid: string,
  previousLevel: number,
  _newXP: number,
): LevelResolution & { levelUp: boolean } {
  const frozen = LEVELS.find((l) => l.level === previousLevel) ?? LEVELS[0];
  return {
    level: frozen.level,
    levelName: frozen.name,
    xpToNextLevel: 0,
    levelUp: false,
  };
}
