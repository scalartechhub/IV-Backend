import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_TOPICS_PER_BUCKET,
  mergeTopicOutcomes,
  normalizeTopic,
  type TopicBuckets,
} from './topic-profile';
import type { TopicOutcome } from '../interfaces/interview.interface';

const emptyBuckets = (): TopicBuckets => ({ strong: [], weak: [] });

describe('normalizeTopic', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    assert.equal(normalizeTopic('  Front End  '), 'front end');
    assert.equal(normalizeTopic('Front   End'), 'front end');
    assert.equal(normalizeTopic('USEEFFECT'), 'useeffect');
  });
});

describe('mergeTopicOutcomes', () => {
  it('adds new strong and weak topics as plain strings', () => {
    const outcomes: TopicOutcome[] = [
      { topic: 'Hooks', status: 'strong' },
      { topic: 'Closures', status: 'weak' },
    ];
    const merged = mergeTopicOutcomes(emptyBuckets(), outcomes);
    assert.deepEqual(merged.strong, ['hooks']);
    assert.deepEqual(merged.weak, ['closures']);
  });

  it('promotes a weak topic to strong when answered well again', () => {
    const current: TopicBuckets = {
      strong: [],
      weak: ['closures'],
    };
    const merged = mergeTopicOutcomes(current, [
      { topic: 'Closures', status: 'strong' },
    ]);
    assert.deepEqual(merged.weak, []);
    assert.deepEqual(merged.strong, ['closures']);
  });

  it('is sticky — a weak outcome on an already-strong topic does not downgrade it', () => {
    const current: TopicBuckets = {
      strong: ['hooks'],
      weak: [],
    };
    const merged = mergeTopicOutcomes(current, [
      { topic: 'hooks', status: 'weak' },
    ]);
    assert.deepEqual(merged.strong, ['hooks']);
    assert.deepEqual(merged.weak, []);
  });

  it('deduplicates by normalized topic name, moving it to the end (most recent)', () => {
    const current: TopicBuckets = {
      strong: ['front end', 'hooks'],
      weak: [],
    };
    const merged = mergeTopicOutcomes(current, [
      { topic: 'Front   End', status: 'strong' },
    ]);
    assert.deepEqual(merged.strong, ['hooks', 'front end']);
  });

  it('caps each bucket at MAX_TOPICS_PER_BUCKET, dropping oldest entries', () => {
    const strong: string[] = [];
    for (let i = 0; i < MAX_TOPICS_PER_BUCKET; i++) {
      strong.push(`topic-${i}`);
    }
    const current: TopicBuckets = { strong, weak: [] };
    const merged = mergeTopicOutcomes(current, [
      { topic: 'newest-topic', status: 'strong' },
    ]);
    assert.equal(merged.strong.length, MAX_TOPICS_PER_BUCKET);
    assert.ok(merged.strong.includes('newest-topic'));
    assert.ok(!merged.strong.includes('topic-0')); // oldest dropped
  });

  it('ignores empty/blank topic names', () => {
    const merged = mergeTopicOutcomes(emptyBuckets(), [
      { topic: '   ', status: 'strong' },
    ]);
    assert.deepEqual(merged.strong, []);
    assert.deepEqual(merged.weak, []);
  });
});
