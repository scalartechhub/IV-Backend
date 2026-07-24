/**
 * Daily practice streak logic. Dates are UTC YYYY-MM-DD.
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { UserGamification } from '../interfaces/user.interface';
import { formatDate, subDays } from '../utils/date-helpers';
import { userRef } from '../utils/firestore-refs';

export interface StreakState {
  streakCount: number;
  longestStreak: number;
  lastActiveDate: string;
}

export interface StreakUpdateResult extends StreakState {
  changed: boolean;
}

/**
 * Update streak given today's and yesterday's UTC date strings.
 * - same day → no change
 * - yesterday → streakCount += 1
 * - otherwise → streakCount = 1
 */
export function updateStreakState(
  current: StreakState,
  today: string,
  yesterday: string,
): StreakUpdateResult {
  if (current.lastActiveDate === today) {
    return { ...current, changed: false };
  }

  let streakCount: number;
  if (current.lastActiveDate === yesterday) {
    streakCount = current.streakCount + 1;
  } else {
    streakCount = 1;
  }

  const longestStreak = Math.max(current.longestStreak, streakCount);
  return {
    streakCount,
    longestStreak,
    lastActiveDate: today,
    changed: true,
  };
}

/**
 * Read gamification, apply UTC streak rules, write back via transaction.
 * Dates use UTC YYYY-MM-DD (documented).
 */
export function updateStreak(
  tx: Transaction,
  db: Firestore,
  uid: string,
  gamification: UserGamification,
  now: Date = new Date(),
): StreakUpdateResult {
  const today = formatDate(now);
  const yesterday = formatDate(subDays(now, 1));
  const result = updateStreakState(
    {
      streakCount: gamification.streakCount,
      longestStreak: gamification.longestStreak,
      lastActiveDate: gamification.lastActiveDate,
    },
    today,
    yesterday,
  );

  if (result.changed) {
    tx.update(userRef(db, uid), {
      'gamification.streakCount': result.streakCount,
      'gamification.longestStreak': result.longestStreak,
      'gamification.lastActiveDate': result.lastActiveDate,
    });
  }

  return result;
}
