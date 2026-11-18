import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isWeeklyProgressEmailEnabled,
  renderWeeklyProgressEmailHtml,
  renderWeeklyProgressEmailText,
  WeeklyProgressReportData,
} from './weekly-report-email.service';

describe('weekly-report-email.service', () => {
  describe('isWeeklyProgressEmailEnabled', () => {
    it('returns false if user is null or undefined', () => {
      assert.equal(isWeeklyProgressEmailEnabled(null), false);
      assert.equal(isWeeklyProgressEmailEnabled(undefined), false);
    });

    it('returns false when coachingPreferences.weeklyEmail is false', () => {
      const user = { coachingPreferences: { weeklyEmail: false } };
      assert.equal(isWeeklyProgressEmailEnabled(user), false);
    });

    it('returns false when preferences.weeklyProgressEmail is false', () => {
      const user = { preferences: { weeklyProgressEmail: false } };
      assert.equal(isWeeklyProgressEmailEnabled(user), false);
    });

    it('returns false when preferences.weeklyEmail is false', () => {
      const user = { preferences: { weeklyEmail: false } };
      assert.equal(isWeeklyProgressEmailEnabled(user), false);
    });

    it('returns false when preferences.notifications.weeklyProgress is false', () => {
      const user = { preferences: { notifications: { weeklyProgress: false } } };
      assert.equal(isWeeklyProgressEmailEnabled(user), false);
    });

    it('returns true when coachingPreferences.weeklyEmail is true', () => {
      const user = { coachingPreferences: { weeklyEmail: true } };
      assert.equal(isWeeklyProgressEmailEnabled(user), true);
    });

    it('returns true by default when no preference is set', () => {
      const user = { displayName: 'John Doe', email: 'john@example.com' };
      assert.equal(isWeeklyProgressEmailEnabled(user), true);
    });
  });

  describe('renderWeeklyProgressEmailHtml & renderWeeklyProgressEmailText', () => {
    const mockReportData: WeeklyProgressReportData = {
      uid: 'user-123',
      recipientEmail: 'alex@example.com',
      recipientName: 'Alex Smith',
      weekRangeText: 'Nov 11 – Nov 18',
      metrics: {
        practiceMinutes: 75,
        interviewsCompletedCount: 2,
        averageScore: 82,
        readinessScore: 78,
        readinessDelta: 4,
        streakDays: 3,
        currentLevel: 2,
        levelName: 'Specialist',
        currentXP: 450,
        topStrengths: ['System Design Decomposition', 'RESTful API Clarity'],
        topRecommendations: ['Concurrency control in Node.js', 'Behavioral STAR structure'],
      },
      recentInterviews: [
        {
          id: 'int-1',
          title: 'Full Stack Engineer Mock Interview',
          mode: 'technical',
          dateStr: 'Nov 16',
          score: 85,
          durationMinutes: 45,
          strengths: ['API Architecture'],
          weaknesses: ['Query optimization'],
        },
        {
          id: 'int-2',
          title: 'Behavioral Culture Fit',
          mode: 'behavioral',
          dateStr: 'Nov 14',
          score: 79,
          durationMinutes: 30,
          strengths: ['Clear Communication'],
          weaknesses: ['STAR structure'],
        },
      ],
      roadmap: {
        hasRoadmap: true,
        technology: 'React & Node.js',
        level: 'Intermediate',
        progressPercent: 45,
        currentWeekNumber: 2,
        currentWeekTitle: 'Advanced State Management & Side Effects',
        completedTopicsCount: 3,
        totalTopicsCount: 5,
        nextTopicName: 'Redux Toolkit Architecture',
      },
      dashboardUrl: 'https://interview-89e09.web.app/home',
      interviewPracticeUrl: 'https://interview-89e09.web.app/interviews',
      learningRoadmapUrl: 'https://interview-89e09.web.app/learning',
      settingsUrl: 'https://interview-89e09.web.app/settings',
    };

    it('renders HTML email with metrics, interview highlights, and roadmap progress', () => {
      const html = renderWeeklyProgressEmailHtml(mockReportData);

      assert.ok(html.includes('Alex Smith'));
      assert.ok(html.includes('Nov 11 – Nov 18'));
      assert.ok(html.includes('Full Stack Engineer Mock Interview'));
      assert.ok(html.includes('85%'));
      assert.ok(html.includes('React & Node.js'));
      assert.ok(html.includes('45%'));
      assert.ok(html.includes('Redux Toolkit Architecture'));
      assert.ok(html.includes('System Design Decomposition'));
      assert.ok(html.includes('+4% this week'));
      assert.ok(html.includes('https://interview-89e09.web.app/home'));
      assert.ok(html.includes('https://interview-89e09.web.app/settings'));

      // Ensure level, XP, and streak/experience are removed from email view
      assert.ok(!html.includes('Total XP'));
      assert.ok(!html.includes('Lvl '));
      assert.ok(!html.includes('Streak'));
      assert.ok(!html.includes('Experience'));
    });

    it('renders plain text email counterpart correctly', () => {
      const text = renderWeeklyProgressEmailText(mockReportData);

      assert.ok(text.includes('Hi Alex Smith'));
      assert.ok(text.includes('Practice Time: 1h 15m'));
      assert.ok(text.includes('Mock Interviews Completed: 2'));
      assert.ok(text.includes('Full Stack Engineer Mock Interview - 85%'));
      assert.ok(text.includes('LEARNING ROADMAP (React & Node.js)'));
      assert.ok(text.includes('Progress: 45%'));
      assert.ok(text.includes('Next to learn: Redux Toolkit Architecture'));
      assert.ok(text.includes('https://interview-89e09.web.app/settings'));

      // Ensure level, XP, and streak/experience are removed from text view
      assert.ok(!text.includes('Total XP'));
      assert.ok(!text.includes('Level '));
      assert.ok(!text.includes('Streak'));
      assert.ok(!text.includes('Experience'));
    });

    it('handles empty interviews and roadmap gracefully with encouragement nudges', () => {
      const emptyData: WeeklyProgressReportData = {
        ...mockReportData,
        metrics: {
          ...mockReportData.metrics,
          practiceMinutes: 0,
          interviewsCompletedCount: 0,
          averageScore: 0,
          streakDays: 0,
          readinessDelta: 0,
          topStrengths: [],
          topRecommendations: [],
        },
        recentInterviews: [],
        roadmap: {
          hasRoadmap: false,
        },
      };

      const html = renderWeeklyProgressEmailHtml(emptyData);
      assert.ok(html.includes('Ready for a practice interview?'));
      assert.ok(html.includes('Personalize Your Learning Track'));
      assert.ok(html.includes('Start a 15-Min Mock Interview'));

      const text = renderWeeklyProgressEmailText(emptyData);
      assert.ok(text.includes("You didn't complete any mock interviews this week"));
    });
  });
});
