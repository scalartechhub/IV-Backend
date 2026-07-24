import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  XP_CAP_PER_INTERVIEW,
  calculateInterviewXp,
  normalizeXpAmount,
} from './xp';

describe('calculateInterviewXp', () => {
  it('computes typical medium interview XP', () => {
    // base 80 + scoreBonus 48 (80*0.6) + duration 20 = 148 * 1.15 ≈ 170
    const xp = calculateInterviewXp({
      overallScore: 80,
      durationSec: 50 * 60,
      durationMinutes: 60,
      difficulty: 'medium',
    });
    assert.equal(xp, Math.round((80 + 48 + 20) * 1.15));
  });

  it('gives no duration bonus when under 80% of planned time', () => {
    const xp = calculateInterviewXp({
      overallScore: 100,
      durationSec: 10 * 60,
      durationMinutes: 60,
      difficulty: 'easy',
    });
    assert.equal(xp, 80 + 60 + 0);
  });

  it('never exceeds XP_CAP_PER_INTERVIEW (defensive ceiling)', () => {
    const xp = calculateInterviewXp({
      overallScore: 100,
      durationSec: 60 * 60,
      durationMinutes: 60,
      difficulty: 'hard',
    });
    // Current formula max is (80+60+20)*1.3 = 208; cap is still enforced
    assert.equal(xp, 208);
    assert.ok(xp <= XP_CAP_PER_INTERVIEW);
  });
});
describe('normalizeXpAmount', () => {
  it('rounds and rejects negatives / non-finite', () => {
    assert.equal(normalizeXpAmount(12.6), 13);
    assert.equal(normalizeXpAmount(-5), 0);
    assert.equal(normalizeXpAmount(Number.NaN), 0);
  });
});
