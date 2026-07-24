// Mirrors src/app/interfaces/xp-transaction.interface.ts � keep in sync
import type { Timestamp } from 'firebase-admin/firestore';

/**
 * XP audit reasons.
 * TODO: architecture §Duplicate recommends xpTransactions but does not enumerate reasons —
 * interview_completed / goal_completed come from Phase 2; achievement_unlocked added for unlocks.
 */
export type XpReason =
  | 'interview_completed'
  | 'goal_completed'
  | 'achievement_unlocked';

/** Path: users/{uid}/xpTransactions/{txId} */
export interface XpTransactionDoc {
  amount: number;
  reason: XpReason;
  relatedId?: string;
  createdAt: Timestamp;
  balanceAfter?: number;
}
