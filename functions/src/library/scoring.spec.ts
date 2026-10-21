import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyCoverageAdjustment,
  applySnippetCoverageAdjustment,
  applyStrictAccuracyAdjustment,
  cleanRecommendations,
  cleanStrengths,
  cleanWeaknesses,
  finalizeCandidateWeaknesses,
  computeCoverageMetrics,
  countCandidateAnswers,
  countCandidateAnswersFromTranscript,
  coverageMultiplier,
  expectedQuestionCount,
  isNonAnswerOrFiller,
  isParrotingQuestion,
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
  isTechDomainInterview: true,
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
    assert.ok(adjusted.overallScore <= 70);
    assert.ok(adjusted.overallScore < 40);
    assert.ok(
      adjusted.weaknesses.some((w) => /ended before the planned time|engagement/i.test(w)),
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
    // Timed-out sessions that answered the questions asked are not crushed for interviewer quota.
    assert.ok(timedOut.overallScore >= earlyQuit.overallScore);
    assert.equal(timedOut.overallScore, 90);
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

describe('applyStrictAccuracyAdjustment', () => {
  it('strictly caps scores when candidate has 0 strong topics (all off-topic / weak)', () => {
    const failingScores: ScoreInterviewResult = {
      ...baseScores(),
      overallScore: 95, // Hallucinated high score
      technicalScore: 100,
      problemSolvingScore: 98,
      codingScore: 90,
      topicOutcomes: [
        { topic: 'React hooks', status: 'weak' },
        { topic: 'Async JavaScript', status: 'weak' },
        { topic: 'State management', status: 'weak' },
      ],
    };

    const adjusted = applyStrictAccuracyAdjustment(failingScores);

    assert.ok(adjusted.technicalScore <= 35, `technicalScore should be <= 35, got ${adjusted.technicalScore}`);
    assert.ok(adjusted.problemSolvingScore <= 35, `problemSolvingScore should be <= 35, got ${adjusted.problemSolvingScore}`);
    assert.ok(adjusted.overallScore <= 45, `overallScore should be <= 45, got ${adjusted.overallScore}`);
    assert.ok((adjusted.codingScore ?? 0) <= 35, `codingScore should be <= 35, got ${adjusted.codingScore}`);
    assert.ok(adjusted.skillDeltas.technical <= -4);
    assert.ok(adjusted.skillDeltas.problemSolving <= -4);
  });

  it('caps mixed performance proportional to strong topic ratio', () => {
    const mixedScores: ScoreInterviewResult = {
      ...baseScores(),
      overallScore: 95,
      technicalScore: 95,
      problemSolvingScore: 95,
      topicOutcomes: [
        { topic: 'React hooks', status: 'strong' },
        { topic: 'Async JavaScript', status: 'weak' },
        { topic: 'State management', status: 'weak' },
        { topic: 'CSS Grid', status: 'weak' },
      ], // 1 of 4 strong = 25% -> max allowed technical ~ 15 + 0.25*85 = 36
    };

    const adjusted = applyStrictAccuracyAdjustment(mixedScores);
    assert.ok(adjusted.technicalScore <= 40, `technicalScore should be <= 40, got ${adjusted.technicalScore}`);
    assert.ok(adjusted.overallScore <= 50, `overallScore should be <= 50, got ${adjusted.overallScore}`);
  });
});

describe('anti-parroting and non-answer detection', () => {
  it('detects evasive or filler non-answers', () => {
    assert.equal(isNonAnswerOrFiller("I don't know"), true);
    assert.equal(isNonAnswerOrFiller('no idea'), true);
    assert.equal(isNonAnswerOrFiller('skip'), true);
    assert.equal(isNonAnswerOrFiller('Pass.'), true);
    assert.equal(isNonAnswerOrFiller('Can you explain dependency injection in Angular?'), false);
  });

  it('detects parroted questions', () => {
    const question = 'Can you explain how closures work in JavaScript?';
    assert.equal(isParrotingQuestion('Can you explain how closures work in JavaScript?', question), true);
    assert.equal(isParrotingQuestion('explain how closures work in javascript', question), true);
    assert.equal(
      isParrotingQuestion('A closure is a function that retains access to its outer scope variables.', question),
      false,
    );
  });

  it('does not count parroted or filler responses in countCandidateAnswers', () => {
    const conversation = [
      { role: 'assistant', text: 'Can you explain how closures work in JavaScript?' },
      { role: 'candidate', text: 'Can you explain how closures work in JavaScript?' }, // parroted
      { role: 'assistant', text: 'What is the purpose of useEffect?' },
      { role: 'candidate', text: 'I do not know' }, // non-answer
      { role: 'assistant', text: 'Tell me about SQL indexing.' },
      { role: 'candidate', text: 'Indexes speed up query read times using B-trees.' }, // genuine answer
    ] as any;

    assert.equal(countCandidateAnswers(conversation), 1);
  });
});

describe('cleanStrengths and cleanWeaknesses', () => {
  it('filters out robotic or patronizing strengths and replaces with professional ones', () => {
    const result = cleanStrengths(['Attended the interview session']);
    assert.equal(result.some((s) => /attended/i.test(s)), false);
    assert.ok(result.length >= 2);
    assert.ok(result.some((s) => /communication|engagement/i.test(s)));
  });

  it('preserves genuine strengths', () => {
    const genuine = [
      'Strong explanation of asynchronous JavaScript',
      'Good familiarity with React hooks',
    ];
    const result = cleanStrengths(genuine);
    assert.deepEqual(result, genuine);
  });

  it('deduplicates repetitive snippet and off-topic weaknesses', () => {
    const rawWeaknesses = [
      'Incomplete code-snippet coverage: asked 1 of 2 required code-snippet questions.',
      'Provided off-topic, irrelevant, or non-answers to technical questions.',
      "Parroted and echoed the interviewer's questions instead of providing solutions.",
      'Failed to demonstrate any technical depth in Angular, Node.js, Firestore, or system design.',
      'Too few code-snippet questions were asked/answered',
    ];

    const cleaned = cleanWeaknesses(rawWeaknesses);

    assert.equal(cleaned.filter((w) => /snippet/i.test(w)).length, 0);
    assert.equal(cleaned.filter((w) => /off-topic|parroted/i.test(w)).length, 1);
    assert.ok(cleaned.some((w) => /technical depth/i.test(w)));
    assert.ok(cleaned.length <= 4);
  });

  it('does not blame the candidate when snippet questions were never asked', () => {
    const scores = baseScores();
    scores.weaknesses = ['Incomplete code-snippet coverage: asked 0 of 2 required code-snippet questions.'];
    const adjusted = applySnippetCoverageAdjustment(scores, {
      codeSnippetQuestionsAsked: 0,
      codeSnippetQuestionsRequired: 2,
    });
    assert.equal(adjusted.overallScore, scores.overallScore);
    assert.equal(cleanWeaknesses(adjusted.weaknesses).some((w) => /snippet/i.test(w)), false);
    assert.equal(
      cleanRecommendations(['Review Angular Signals', 'Complete the 2 missing code-snippet questions']).length,
      1,
    );
  });

  it('turns weak topic outcomes into improvement areas', () => {
    const notes = finalizeCandidateWeaknesses({
      ...baseScores(),
      weaknesses: ['Incomplete code-snippet coverage: asked 0 of 2 required code-snippet questions.'],
      topicOutcomes: [
        { topic: 'HTTP interceptors', status: 'strong' },
        { topic: 'Angular change detection', status: 'weak' },
      ],
    });
    assert.equal(notes.some((w) => /snippet/i.test(w)), false);
    assert.ok(notes.some((w) => /change detection/i.test(w)));
  });
});

