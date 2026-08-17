import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeMetricValue } from './achievement.service';
import type { UserDoc } from '../interfaces/user.interface';

/** Minimal UserDoc factory — only the fields computeMetricValue actually reads matter. */
function makeUser(overrides: Partial<UserDoc> = {}): UserDoc {
  return {
    uid: 'test-uid',
    email: 'test@example.com',
    displayName: 'Test User',
    provider: 'password',
    createdAt: null as never,
    lastLoginAt: null as never,
    profile: {
      currentRole: '',
      yearsExperience: 0,
      targetRole: '',
      targetCompanies: [],
      location: '',
    },
    gamification: {
      level: 1,
      levelName: 'Candidate',
      currentXP: 0,
      xpToNextLevel: 500,
      streakCount: 0,
      lastActiveDate: '',
      longestStreak: 0,
    },
    readiness: {
      score: 0,
      deltaWeek: 0,
      percentileVsRole: 0,
      lastComputedAt: null as never,
    },
    preferences: {
      dailyReminders: false,
      aiVoiceFeedback: false,
      focusMode: false,
      weeklyProgressEmail: false,
      darkMode: false,
    },
    subscription: { plan: 'free' },
    ...overrides,
  };
}

describe('computeMetricValue', () => {
  it('interviews_completed reads stats.totalInterviews', () => {
    const user = makeUser({ stats: { totalInterviews: 7, problemsSolved: 0 } });
    assert.equal(computeMetricValue('interviews_completed', 0, user, {}), 7);
  });

  it('successful_interviews reads stats.successfulInterviews (absolute counter)', () => {
    const user = makeUser({
      stats: { totalInterviews: 10, problemsSolved: 0, successfulInterviews: 4 },
    });
    assert.equal(computeMetricValue('successful_interviews', 3, user, {}), 4);
  });

  it('successful_interviews falls back to previousValue when stat missing', () => {
    const user = makeUser({ stats: { totalInterviews: 10, problemsSolved: 0 } });
    assert.equal(computeMetricValue('successful_interviews', 2, user, {}), 2);
  });

  it('streak_days reads gamification.streakCount', () => {
    const user = makeUser({
      gamification: {
        level: 1,
        levelName: 'Candidate',
        currentXP: 0,
        xpToNextLevel: 500,
        streakCount: 5,
        lastActiveDate: '2026-08-01',
        longestStreak: 5,
      },
    });
    assert.equal(computeMetricValue('streak_days', 0, user, {}), 5);
  });

  it('highest_score keeps the max of previous vs this interview overallScore', () => {
    const user = makeUser();
    assert.equal(computeMetricValue('highest_score', 60, user, { overallScore: 45 }), 60);
    assert.equal(computeMetricValue('highest_score', 60, user, { overallScore: 82 }), 82);
  });

  it('delivery_score prefers explicit deliveryScore, then skillScores.communication', () => {
    const user = makeUser();
    assert.equal(
      computeMetricValue('delivery_score', 0, user, {
        deliveryScore: 70,
        skillScores: { communication: 40 },
      }),
      70,
    );
    assert.equal(
      computeMetricValue('delivery_score', 0, user, { skillScores: { communication: 55 } }),
      55,
    );
  });

  it('content_score falls back to overallScore when no explicit/skill score given', () => {
    const user = makeUser();
    assert.equal(computeMetricValue('content_score', 0, user, { overallScore: 77 }), 77);
  });

  it('communication_score / confidence_score / problem_solving_score / technical_score / behavior_score track skillScores maxima', () => {
    const user = makeUser();
    const opts = {
      skillScores: {
        communication: 81,
        confidence: 72,
        problemSolving: 88,
        technical: 90,
        behavior: 65,
      },
    };
    assert.equal(computeMetricValue('communication_score', 0, user, opts), 81);
    assert.equal(computeMetricValue('confidence_score', 0, user, opts), 72);
    assert.equal(computeMetricValue('problem_solving_score', 0, user, opts), 88);
    assert.equal(computeMetricValue('technical_score', 0, user, opts), 90);
    assert.equal(computeMetricValue('behavior_score', 0, user, opts), 65);
    // never regresses below a higher previous value
    assert.equal(computeMetricValue('technical_score', 95, user, opts), 95);
  });

  it('domain_sessions increments only when the interview track matches', () => {
    const user = makeUser();
    assert.equal(
      computeMetricValue('domain_sessions', 2, user, { tracks: ['React', 'Node'] }, 'react'),
      3,
    );
    assert.equal(
      computeMetricValue('domain_sessions', 2, user, { tracks: ['react'] }, 'angular'),
      2,
    );
    // track names are normalized (case/whitespace/underscore insensitive)
    assert.equal(
      computeMetricValue('domain_sessions', 0, user, { tracks: ['System Design'] }, 'system_design'),
      1,
    );
  });

  it('score_improvement keeps the max scoreImprovement seen across interviews', () => {
    const user = makeUser();
    assert.equal(computeMetricValue('score_improvement', 5, user, { scoreImprovement: 3 }), 5);
    assert.equal(computeMetricValue('score_improvement', 5, user, { scoreImprovement: 12 }), 12);
  });

  it('problems_solved reads stats.problemsSolved', () => {
    const user = makeUser({ stats: { totalInterviews: 0, problemsSolved: 6 } });
    assert.equal(computeMetricValue('problems_solved', 0, user, {}), 6);
  });

  it('resume_analysis_completed is a boolean gate (1 once true, else keeps previous)', () => {
    const done = makeUser({ resumeAnalysisCompleted: true });
    const notDone = makeUser({ resumeAnalysisCompleted: false });
    assert.equal(computeMetricValue('resume_analysis_completed', 0, done, {}), 1);
    assert.equal(computeMetricValue('resume_analysis_completed', 0, notDone, {}), 0);
  });

  it('roadmap_weeks_completed reads stats.roadmapWeeksCompleted', () => {
    const user = makeUser({
      stats: { totalInterviews: 0, problemsSolved: 0, roadmapWeeksCompleted: 3 },
    });
    assert.equal(computeMetricValue('roadmap_weeks_completed', 0, user, {}), 3);
  });

  it('unknown metric falls back to previousValue instead of throwing', () => {
    const user = makeUser();
    assert.equal(
      computeMetricValue('not_a_real_metric' as never, 9, user, {}),
      9,
    );
  });
});

describe('unlock decision (mirrors checkAchievements logic)', () => {
  function isUnlocked(currentValue: number, targetValue: number, alreadyUnlocked = false) {
    return alreadyUnlocked || currentValue >= targetValue;
  }

  it('unlocks exactly at target, not before', () => {
    assert.equal(isUnlocked(9, 10), false);
    assert.equal(isUnlocked(10, 10), true);
  });

  it('stays unlocked even if a later computed value would be lower (score metrics never regress, but this guards regressions in general)', () => {
    assert.equal(isUnlocked(3, 10, true), true);
  });
});
