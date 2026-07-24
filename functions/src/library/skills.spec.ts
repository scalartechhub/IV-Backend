import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_SKILL_SCORE,
  applySkillDelta,
  updateSkillScores,
} from './skills';

describe('applySkillDelta', () => {
  it('applies EMA smoothing for a typical positive delta', () => {
    // prev=50, delta=+10 → raw=60 → round(50*0.85 + 60*0.15) = round(42.5+9)=52
    assert.equal(applySkillDelta(50, 10), 52);
  });

  it('clamps raw at 0 for large negative deltas', () => {
    // prev=5, delta=-20 → raw=0 → round(5*0.85 + 0*0.15)=4
    assert.equal(applySkillDelta(5, -20), 4);
  });

  it('defaults non-finite prev to DEFAULT_SKILL_SCORE', () => {
    assert.equal(applySkillDelta(Number.NaN, 0), DEFAULT_SKILL_SCORE);
  });
});

describe('updateSkillScores', () => {
  it('fills missing skills with default and zero delta', () => {
    const result = updateSkillScores({ technical: 70 }, { technical: 5 });
    assert.equal(result.technical, applySkillDelta(70, 5));
    assert.equal(result.coding, DEFAULT_SKILL_SCORE);
  });
});
