import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveLevel } from './level';

describe('resolveLevel', () => {
  it('returns Candidate at 0 XP', () => {
    const r = resolveLevel(0);
    assert.equal(r.level, 1);
    assert.equal(r.levelName, 'Candidate');
    assert.equal(r.xpToNextLevel, 500);
  });

  it('crosses Developer boundary at exactly 500 XP', () => {
    const r = resolveLevel(500);
    assert.equal(r.level, 2);
    assert.equal(r.levelName, 'Developer');
    assert.equal(r.xpToNextLevel, 1500);
  });

  it('returns xpToNextLevel 0 at max Architect level', () => {
    const r = resolveLevel(12_000);
    assert.equal(r.level, 5);
    assert.equal(r.levelName, 'Architect');
    assert.equal(r.xpToNextLevel, 0);
  });
});
