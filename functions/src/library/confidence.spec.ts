import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aggregateFacialConfidence,
  calculateHiringProbability,
  combineConfidenceSignals,
} from './confidence';

describe('combineConfidenceSignals', () => {
  it('uses text-only when audio/facial are absent', () => {
    assert.equal(combineConfidenceSignals({ textSignal: 72 }), 72);
  });

  it('averages text + audio 50/50', () => {
    assert.equal(
      combineConfidenceSignals({ textSignal: 80, audioSignal: 60 }),
      70,
    );
  });

  it('blends text + audio + facial with ~equal weights', () => {
    // 0.34*90 + 0.33*60 + 0.33*30 = 30.6 + 19.8 + 9.9 = 60.3 → 60
    assert.equal(
      combineConfidenceSignals({
        textSignal: 90,
        audioSignal: 60,
        facialSignal: 30,
      }),
      60,
    );
  });

  it('blends text + facial 50/50 when audio is missing', () => {
    assert.equal(
      combineConfidenceSignals({ textSignal: 80, facialSignal: 40 }),
      60,
    );
  });
});

describe('calculateHiringProbability', () => {
  it('falls back to overallScore when resumeScore is missing', () => {
    const withResume = calculateHiringProbability({
      overallScore: 80,
      technicalScore: 80,
      communicationScore: 80,
      confidenceScore: 80,
      problemSolvingScore: 80,
      resumeScore: 40,
    });
    const withoutResume = calculateHiringProbability({
      overallScore: 80,
      technicalScore: 80,
      communicationScore: 80,
      confidenceScore: 80,
      problemSolvingScore: 80,
    });
    // Missing resume uses overall (80) instead of 40 → higher probability
    assert.ok(withoutResume > withResume);
    assert.equal(withoutResume, 80);
  });
});

describe('aggregateFacialConfidence', () => {
  it('returns null for empty signals', () => {
    assert.equal(aggregateFacialConfidence([]), null);
  });

  it('scores confident-dominant frames higher than nervous ones', () => {
    const confident = aggregateFacialConfidence([
      {
        dominantEmotion: 'confident',
        emotionScores: { confident: 90, neutral: 10 },
      },
    ]);
    const nervous = aggregateFacialConfidence([
      {
        dominantEmotion: 'nervous',
        emotionScores: { nervous: 90, confused: 10 },
      },
    ]);
    assert.ok(confident != null && nervous != null);
    assert.ok(confident > nervous);
  });
});
