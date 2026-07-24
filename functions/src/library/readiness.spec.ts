import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculateReadiness,
  calculateReadinessDeltaWeek,
} from './readiness';

describe('calculateReadiness', () => {
  it('returns weighted average for typical skills', () => {
    const score = calculateReadiness({
      technical: 80,
      coding: 70,
      problemSolving: 60,
      communication: 90,
      confidence: 50,
      behavior: 40,
    });
    // 80*0.25 + 70*0.2 + 60*0.2 + 90*0.15 + 50*0.1 + 40*0.1
    // = 20 + 14 + 12 + 13.5 + 5 + 4 = 68.5 → 69
    assert.equal(score, 69);
  });

  it('defaults missing skills to 50', () => {
    assert.equal(calculateReadiness({}), 50);
  });

  it('computes deltaWeek as current - snapshot (0 if missing)', () => {
    assert.equal(calculateReadinessDeltaWeek(82, 76), 6);
    assert.equal(calculateReadinessDeltaWeek(82, undefined), 0);
  });
});
