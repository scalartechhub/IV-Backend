/**
 * XP → level resolution with hardcoded thresholds.
 */

import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { notificationsCol, userRef } from '../utils/firestore-refs';

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
 * Persist resolved level fields; if level increased, create a level_up notification.
 */
export function applyLevelUpdate(
  tx: Transaction,
  db: Firestore,
  uid: string,
  previousLevel: number,
  newXP: number,
): LevelResolution & { levelUp: boolean } {
  const resolved = resolveLevel(newXP);
  const levelUp = resolved.level > previousLevel;

  tx.update(userRef(db, uid), {
    'gamification.level': resolved.level,
    'gamification.levelName': resolved.levelName,
    'gamification.xpToNextLevel': resolved.xpToNextLevel,
  });

  if (levelUp) {
    const notifRef = notificationsCol(db, uid).doc();
    tx.set(notifRef, {
      type: 'level_up',
      title: `Level up! You're now ${resolved.levelName}`,
      body: `You reached level ${resolved.level}.`,
      read: false,
      createdAt: FieldValue.serverTimestamp() as never,
      actionUrl: '/career',
    });
  }

  return { ...resolved, levelUp };
}
