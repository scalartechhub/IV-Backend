import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeSkillSignals } from './skill-signals';
import type { InterviewResults } from '../interfaces/interview.interface';

const result = (overrides: Partial<InterviewResults> = {}): InterviewResults => ({
  overallScore: 80,
  technicalScore: 80,
  communicationScore: 70,
  confidenceScore: 60,
  problemSolvingScore: 75,
  skillDeltas: {},
  strengths: [],
  weaknesses: [],
  recommendations: [],
  ...overrides,
});

describe('computeSkillSignals', () => {
  it('averages each skill across the given results', () => {
    const results = [
      result({ technicalScore: 80, communicationScore: 60 }),
      result({ technicalScore: 60, communicationScore: 80 }),
    ];
    const skillSignals = computeSkillSignals(results);
    assert.equal(skillSignals.technical, 70);
    assert.equal(skillSignals.communication, 70);
  });

  it('defaults skills with no data across the sample to 0 (e.g. codingScore on non-coding interviews)', () => {
    const results = [result(), result()];
    const skillSignals = computeSkillSignals(results);
    assert.equal(skillSignals.coding, 0);
    assert.equal(skillSignals.behavior, 0);
  });

  it('only averages codingScore/behaviorScore over interviews where they are present', () => {
    const results = [
      result({ codingScore: 90 }),
      result(), // no codingScore
      result({ codingScore: 70 }),
    ];
    const skillSignals = computeSkillSignals(results);
    assert.equal(skillSignals.coding, 80); // (90+70)/2, not /3
  });

  it('includes totalScore in the same object as the average of all 6 skill signals', () => {
    const results = [
      result({
        technicalScore: 100,
        communicationScore: 100,
        confidenceScore: 100,
        problemSolvingScore: 100,
        codingScore: 100,
        behaviorScore: 100,
      }),
    ];
    const skillSignals = computeSkillSignals(results);
    assert.equal(skillSignals.totalScore, 100);
  });

  it('returns all zeros with no interviews', () => {
    const skillSignals = computeSkillSignals([]);
    assert.deepEqual(skillSignals, {
      technical: 0,
      communication: 0,
      confidence: 0,
      problemSolving: 0,
      coding: 0,
      behavior: 0,
      totalScore: 0,
    });
  });
});
