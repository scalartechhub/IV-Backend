/**
 * Cross-interview topic mastery tracking (users/{uid}/interviewTopics/profile).
 * Lets the interviewer avoid repeating mastered topics and prioritize weak ones,
 * promoting weak -> strong once a topic is answered well again.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { TopicOutcome } from '../interfaces/interview.interface';
import { topicProfileRef } from '../utils/firestore-refs';

export const MAX_TOPICS_PER_BUCKET = 150;

export interface TopicBuckets {
  strong: string[];
  weak: string[];
}

const EMPTY_BUCKETS: TopicBuckets = { strong: [], weak: [] };

/** Lowercase, trim, collapse internal whitespace so variants dedupe (e.g. "Front End" / "front  end"). */
export function normalizeTopic(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Move topic to the end (most recent) of the list, deduping any prior occurrence. */
function upsert(list: string[], topic: string): string[] {
  return [...list.filter((t) => t !== topic), topic];
}

function removeTopic(list: string[], topic: string): string[] {
  return list.filter((t) => t !== topic);
}

/** Drop oldest entries beyond the cap (list order = insertion/recency order) so lists don't grow unbounded. */
function capBucket(list: string[], max: number): string[] {
  if (list.length <= max) return list;
  return list.slice(list.length - max);
}

/**
 * Merge this interview's topic outcomes into the existing strong/weak buckets.
 * Pure function — safe to unit test without Firestore.
 *
 * Rules:
 * - status "strong": remove from weak (if present), upsert into strong.
 * - status "weak": if already strong, leave strong untouched (sticky — a single weak
 *   turn should not erase prior mastery); otherwise upsert into weak.
 */
export function mergeTopicOutcomes(
  current: TopicBuckets,
  outcomes: TopicOutcome[],
): TopicBuckets {
  let strong = [...current.strong];
  let weak = [...current.weak];

  for (const outcome of outcomes) {
    const topic = normalizeTopic(outcome.topic);
    if (!topic) continue;

    const isAlreadyStrong = strong.includes(topic);

    if (outcome.status === 'strong') {
      weak = removeTopic(weak, topic);
      strong = upsert(strong, topic);
    } else if (!isAlreadyStrong) {
      weak = upsert(weak, topic);
    }
    // else: already strong + this outcome weak -> sticky, no change.
  }

  return {
    strong: capBucket(strong, MAX_TOPICS_PER_BUCKET),
    weak: capBucket(weak, MAX_TOPICS_PER_BUCKET),
  };
}

/** Read the current topic profile, defaulting to empty buckets when missing. */
export async function loadTopicProfile(
  db: Firestore,
  uid: string,
): Promise<TopicBuckets> {
  const snap = await topicProfileRef(db, uid).get();
  if (!snap.exists) return EMPTY_BUCKETS;
  const data = snap.data() as Partial<TopicBuckets> | undefined;
  return {
    strong: data?.strong ?? [],
    weak: data?.weak ?? [],
  };
}

/**
 * Merge this interview's topic outcomes into the user's profile and persist.
 * Best-effort — callers should wrap in `.catch()` so a failure here never
 * blocks interview completion (same pattern as generateReport / checkAchievements).
 */
export async function updateTopicProfile(
  db: Firestore,
  uid: string,
  outcomes: TopicOutcome[],
): Promise<void> {
  if (!outcomes.length) return;

  const current = await loadTopicProfile(db, uid);
  const merged = mergeTopicOutcomes(current, outcomes);

  await topicProfileRef(db, uid).set(
    {
      strong: merged.strong,
      weak: merged.weak,
    },
    { merge: true },
  );
}
