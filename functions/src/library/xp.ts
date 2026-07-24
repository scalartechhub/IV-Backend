/**
 * XP calculation helpers for interview completion and related rewards.
 * All XP mutations must go through this module.
 */

import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { InterviewDifficulty } from '../interfaces/interview.interface';
import type { XpReason } from '../interfaces/xp-transaction.interface';
import { userRef, xpTransactionsCol } from '../utils/firestore-refs';

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
 * Compute XP earned for a completed interview.
 * Formula: round((baseXP + scoreBonus + durationBonus) * difficultyMultiplier), capped at 250.
 */
export function calculateInterviewXp(input: InterviewXpInput): number {
  const baseXP = XP_BASE;
  const scoreBonus = Math.round(input.overallScore * 0.6);
  const plannedSec = input.durationMinutes * 60;
  const durationBonus = input.durationSec >= plannedSec * 0.8 ? 20 : 0;
  const multiplier = DIFFICULTY_MULTIPLIER[input.difficulty];
  const xpEarned = Math.round((baseXP + scoreBonus + durationBonus) * multiplier);
  return Math.min(xpEarned, XP_CAP_PER_INTERVIEW);
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
 * Write an xpTransactions audit doc and increment users/{uid}.gamification.currentXP.
 * Must be the only place that increments currentXP.
 */
export function creditXpInTransaction(
  tx: Transaction,
  db: Firestore,
  uid: string,
  credit: XpCredit,
  balanceAfter?: number,
): void {
  const amount = normalizeXpAmount(credit.amount);
  if (amount <= 0) return;

  const txRef = xpTransactionsCol(db, uid).doc();
  tx.set(txRef, {
    amount,
    reason: credit.reason,
    relatedId: credit.relatedId,
    createdAt: FieldValue.serverTimestamp() as never,
    ...(balanceAfter !== undefined ? { balanceAfter } : {}),
  });

  tx.update(userRef(db, uid), {
    'gamification.currentXP': FieldValue.increment(amount),
  });
}
