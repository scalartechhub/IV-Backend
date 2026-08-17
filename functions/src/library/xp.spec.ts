import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateInterviewXp, normalizeXpAmount } from './xp';

describe('calculateInterviewXp', () => {
  it('always returns 0 — XP rewards are disabled app-wide', () => {
    const xp = calculateInterviewXp({
      overallScore: 100,
      durationSec: 60 * 60,
      durationMinutes: 60,
      difficulty: 'hard',
    });
    assert.equal(xp, 0);
  });
});

describe('normalizeXpAmount', () => {
  it('rounds and rejects negatives / non-finite', () => {
    assert.equal(normalizeXpAmount(12.6), 13);
    assert.equal(normalizeXpAmount(-5), 0);
    assert.equal(normalizeXpAmount(Number.NaN), 0);
  });
});
