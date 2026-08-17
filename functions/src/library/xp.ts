/**
 * XP calculation helpers for interview completion and related rewards.
 * All XP mutations must go through this module.
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { InterviewDifficulty } from '../interfaces/interview.interface';
import type { XpReason } from '../interfaces/xp-transaction.interface';

export const XP_BASE = 80;
export const XP_CAP_PER_INTERVIEW = 250;

export const DIFFICULTY_MULTIPLIER: Record<InterviewDifficulty, number> = {
  easy: 1.0,
  medium: 1.15,
  hard: 1.3,
};

export interface InterviewXpInput {
  overallScore: number;
  durationSec: number;
  durationMinutes: number;
  difficulty: InterviewDifficulty;
}

/**
 * XP rewards have been disabled app-wide. Kept as a no-op (rather than deleted) so every
 * call site that still computes/displays "xpEarned" continues to compile and simply shows 0.
 */
export function calculateInterviewXp(_input: InterviewXpInput): number {
  return 0;
}

export interface XpCredit {
  amount: number;
  reason: XpReason;
  relatedId?: string;
}

/**
 * Clamp a raw XP amount to a non-negative integer (for goal rewards etc.).
 */
export function normalizeXpAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount);
}

/**
 * XP rewards have been disabled app-wide — this is now a no-op so `gamification.currentXP`
 * never changes and no xpTransactions audit docs are written. Kept as a no-op (rather than
 * deleted/removed from call sites) since this was documented as "the only place that
 * increments currentXP"; disabling it here guarantees no XP is credited from anywhere.
 */
export function creditXpInTransaction(
  _tx: Transaction,
  _db: Firestore,
  _uid: string,
  _credit: XpCredit,
  _balanceAfter?: number,
): void {
  return;
}
