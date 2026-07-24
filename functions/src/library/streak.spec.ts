import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { updateStreakState } from './streak';

describe('updateStreakState', () => {
  it('increments when last active was yesterday', () => {
    const result = updateStreakState(
      { streakCount: 3, longestStreak: 5, lastActiveDate: '2026-07-23' },
      '2026-07-24',
      '2026-07-23',
    );
    assert.equal(result.streakCount, 4);
    assert.equal(result.longestStreak, 5);
    assert.equal(result.changed, true);
  });

  it('is a no-op when already active today', () => {
    const result = updateStreakState(
      { streakCount: 7, longestStreak: 12, lastActiveDate: '2026-07-24' },
      '2026-07-24',
      '2026-07-23',
    );
    assert.equal(result.streakCount, 7);
    assert.equal(result.changed, false);
  });

  it('resets to 1 after a gap day', () => {
    const result = updateStreakState(
      { streakCount: 10, longestStreak: 10, lastActiveDate: '2026-07-20' },
      '2026-07-24',
      '2026-07-23',
    );
    assert.equal(result.streakCount, 1);
    assert.equal(result.longestStreak, 10);
    assert.equal(result.lastActiveDate, '2026-07-24');
  });
});
