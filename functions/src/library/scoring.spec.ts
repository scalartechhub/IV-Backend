import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyCoverageAdjustment,
  computeCoverageMetrics,
  countCandidateAnswersFromTranscript,
  coverageMultiplier,
  expectedQuestionCount,
  type ScoreInterviewResult,
} from './scoring';

const baseScores = (): ScoreInterviewResult => ({
  overallScore: 90,
  technicalScore: 90,
  communicationScore: 88,
  confidenceScore: 85,
  problemSolvingScore: 92,
  skillDeltas: { technical: 4, communication: 2, confidence: 1, problemSolving: 3 },
  strengths: ['Clear answers'],
  weaknesses: [],
  recommendations: ['Keep practicing'],
  topicOutcomes: [
    { topic: 'useEffect cleanup', status: 'strong' },
    { topic: 'closures', status: 'weak' },
  ],
});

describe('expectedQuestionCount', () => {
  it('targets ~1 question per 3 minutes within bounds', () => {
    assert.equal(expectedQuestionCount(30), 10);
    assert.equal(expectedQuestionCount(15), 5);
    assert.equal(expectedQuestionCount(5), 4); // floor
    assert.equal(expectedQuestionCount(60), 16); // ceil
  });
});

describe('coverageMultiplier', () => {
  it('gives full credit at 80%+ coverage', () => {
    assert.equal(coverageMultiplier(0.8), 1);
    assert.equal(coverageMultiplier(1), 1);
  });

  it('scales down sparse coverage', () => {
    assert.ok(coverageMultiplier(0.2) <= 0.25);
    assert.ok(coverageMultiplier(0.5) >= 0.69 && coverageMultiplier(0.5) <= 0.71);
  });
});

describe('computeCoverageMetrics', () => {
  it('computes answered/expected and time ratios', () => {
    const m = computeCoverageMetrics({
      durationSec: 5 * 60,
      durationMinutes: 30,
      questionsAnswered: 2,
    });
    assert.equal(m.expectedQuestions, 10);
    assert.equal(m.coverageRatio, 0.2);
    assert.ok(Math.abs(m.timeRatio - 5 / 30) < 0.001);
  });
});

describe('countCandidateAnswersFromTranscript', () => {
  it('counts Candidate lines', () => {
    const transcript = [
      'Interviewer: Tell me about React hooks.',
      'Candidate: useState and useEffect manage state and side effects.',
      'Interviewer: Explain keys in lists.',
      'Candidate: Keys help React reconcile list items.',
    ].join('\n');
    assert.equal(countCandidateAnswersFromTranscript(transcript), 2);
  });
});

describe('applyCoverageAdjustment', () => {
  it('caps early user_ended sessions with few answers', () => {
    const adjusted = applyCoverageAdjustment(baseScores(), {
      durationSec: 5 * 60,
      durationMinutes: 30,
      endReason: 'user_ended',
      questionsAnswered: 2,
      questionsAsked: 2,
    });
    // 90 * ~0.25 coverage, then hardCap 50
    assert.ok(adjusted.overallScore <= 50);
    assert.ok(adjusted.overallScore < 40);
    assert.ok(
      adjusted.weaknesses.some((w) => /Incomplete coverage/i.test(w)),
    );
    // Firestore rejects explicit undefined on optional fields
    assert.equal('behaviorScore' in adjusted, false);
    assert.equal('codingScore' in adjusted, false);
  });

  it('does not hard-cap time_expired the same way as early quit', () => {
    const earlyQuit = applyCoverageAdjustment(baseScores(), {
      durationSec: 5 * 60,
      durationMinutes: 30,
      endReason: 'user_ended',
      questionsAnswered: 2,
    });
    const timedOut = applyCoverageAdjustment(baseScores(), {
      durationSec: 30 * 60,
      durationMinutes: 30,
      endReason: 'time_expired',
      questionsAnswered: 2,
    });
    // Both sparse on questions, but timedOut has no 50 hard cap from early exit
    assert.ok(timedOut.overallScore <= earlyQuit.overallScore + 5);
    assert.ok(timedOut.overallScore <= 30); // 90 * 0.25-ish
  });

  it('leaves near-complete sessions unchanged', () => {
    const scores = baseScores();
    const adjusted = applyCoverageAdjustment(scores, {
      durationSec: 28 * 60,
      durationMinutes: 30,
      endReason: 'user_ended',
      questionsAnswered: 9,
      questionsAsked: 10,
    });
    assert.equal(adjusted.overallScore, 90);
  });

  it('passes topicOutcomes through unchanged regardless of coverage adjustment', () => {
    const adjusted = applyCoverageAdjustment(baseScores(), {
      durationSec: 5 * 60,
      durationMinutes: 30,
      endReason: 'user_ended',
      questionsAnswered: 2,
    });
    assert.deepEqual(adjusted.topicOutcomes, [
      { topic: 'useEffect cleanup', status: 'strong' },
      { topic: 'closures', status: 'weak' },
    ]);
  });
});
