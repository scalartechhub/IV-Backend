/**
 * Weekly Interview & Learning Progress Email Service.
 *
 * Gathers user activity for the past 7 days (mock interviews, learning roadmap,
 * practice minutes, readiness score, and coaching tips), verifies user notification
 * preferences, and sends a weekly progress summary email via Nodemailer.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { ensureAdmin } from '../utils/callable-auth';
import { logger } from '../shared/logger';
import { appConfig } from '../config/app.config';
import { getWeekStart, formatDate, subDays } from '../utils/date-helpers';
import { weeklyStatsRef } from '../utils/firestore-refs';
import { sendEmail } from './email.service';
import { getActiveRoadmap } from './learning-roadmap.service';
import type { RoadmapWeek } from '../interfaces/learning-roadmap.interface';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface WeeklyInterviewItem {
  id: string;
  title: string;
  mode: string;
  dateStr: string;
  score: number;
  durationMinutes: number;
  strengths: string[];
  weaknesses: string[];
}

export interface WeeklyRoadmapProgress {
  hasRoadmap: boolean;
  technology?: string;
  level?: string;
  progressPercent?: number;
  currentWeekNumber?: number;
  currentWeekTitle?: string;
  completedTopicsCount?: number;
  totalTopicsCount?: number;
  nextTopicName?: string;
}

export interface WeeklyActivityMetrics {
  practiceMinutes: number;
  interviewsCompletedCount: number;
  averageScore: number;
  readinessScore: number;
  readinessDelta: number;
  streakDays?: number;
  currentLevel?: number;
  levelName?: string;
  currentXP?: number;
  topStrengths: string[];
  topRecommendations: string[];
}

export interface WeeklyProgressReportData {
  uid: string;
  recipientEmail: string;
  recipientName: string;
  weekRangeText: string;
  metrics: WeeklyActivityMetrics;
  recentInterviews: WeeklyInterviewItem[];
  roadmap: WeeklyRoadmapProgress;
  dashboardUrl: string;
  interviewPracticeUrl: string;
  learningRoadmapUrl: string;
  settingsUrl: string;
}

export interface BatchSendResult {
  totalScanned: number;
  eligibleCount: number;
  sentCount: number;
  failedCount: number;
  skippedOptOutCount: number;
  skippedNoEmailCount: number;
  dryRun: boolean;
  errors?: Array<{ uid: string; email?: string; error: string }>;
}

// ─── User Preference Check ──────────────────────────────────────────────────

/**
 * Checks whether the user has weekly progress emails enabled.
 * Defaults to true if not explicitly opted out, matching the UI settings default.
 */
export function isWeeklyProgressEmailEnabled(user: any): boolean {
  if (!user) return false;

  // Explicit opt-out in coachingPreferences
  if (user.coachingPreferences?.weeklyEmail === false) {
    return false;
  }
  // Explicit opt-out in v2 preferences
  if (user.preferences?.weeklyProgressEmail === false) {
    return false;
  }
  if (user.preferences?.weeklyEmail === false) {
    return false;
  }
  if (user.preferences?.notifications?.weeklyProgress === false) {
    return false;
  }

  return true;
}

// ─── Data Builder ───────────────────────────────────────────────────────────

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function computeRoadmapProgressPercent(weeks: RoadmapWeek[]): number {
  let total = 0;
  let completed = 0;
  for (const week of weeks) {
    for (const topic of week.topics) {
      total += topic.subtopics.length + topic.quizzes.length;
      completed += topic.subtopics.filter((s) => s.isComplete).length;
      completed += topic.quizzes.filter(
        (q) => q.isComplete && (q.score ?? 0) >= 60,
      ).length;
    }
  }
  return total > 0 ? Math.round((completed / total) * 100) : 0;
}

/**
 * Aggregates all activity data for a single user over the past 7 days.
 */
export async function buildWeeklyProgressReportData(
  uid: string,
  preloadedUser?: any,
): Promise<WeeklyProgressReportData | null> {
  const db: Firestore = ensureAdmin();

  // 1. Fetch user document if not preloaded
  let user: any = preloadedUser;
  if (!user) {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) return null;
    user = { id: userDoc.id, ...(userDoc.data() || {}) };
  }

  const recipientEmail = (user.email || '').trim();
  if (!recipientEmail || !recipientEmail.includes('@')) {
    return null;
  }

  const recipientName =
    (user.displayName || user.name || recipientEmail.split('@')[0] || 'Candidate').trim();

  // 2. Date boundaries (past 7 days)
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekStart = getWeekStart(now);
  const weekRangeText = `${formatShortDate(sevenDaysAgo)} – ${formatShortDate(now)}`;

  // 3. Fetch recent completed interviews
  const recentInterviews: WeeklyInterviewItem[] = [];
  try {
    const interviewSnap = await db
      .collection('interviews')
      .where('userId', '==', uid)
      .limit(40)
      .get();

    for (const doc of interviewSnap.docs) {
      const data = doc.data();
      if (data.isDeleted) continue;

      const completedAtDate = data.completedAt?.toDate
        ? data.completedAt.toDate()
        : data.updatedAt?.toDate
        ? data.updatedAt.toDate()
        : null;

      // Only count interviews completed in the last 7 days
      if (data.status === 'completed' || data.results) {
        if (completedAtDate && completedAtDate >= sevenDaysAgo) {
          const durationMins = Math.round(
            (data.durationSec ?? (data.config?.durationMinutes ? data.config.durationMinutes * 60 : 0)) / 60,
          );
          const title =
            data.config?.targetRole ||
            data.config?.topic ||
            data.config?.company ||
            `${(data.mode || 'Practice').charAt(0).toUpperCase() + (data.mode || 'Practice').slice(1)} Interview`;

          recentInterviews.push({
            id: doc.id,
            title,
            mode: data.mode || 'conversational',
            dateStr: formatShortDate(completedAtDate),
            score: data.results?.overallScore ?? 0,
            durationMinutes: durationMins > 0 ? durationMins : (data.config?.durationMinutes ?? 15),
            strengths: (data.results?.strengths || []).slice(0, 3),
            weaknesses: (data.results?.weaknesses || data.results?.recommendations || []).slice(0, 3),
          });
        }
      }
    }
  } catch (err: any) {
    logger.warn(`[WeeklyReportEmail] Failed querying interviews for ${uid}`, { error: err.message });
  }

  // Sort interviews newest first
  recentInterviews.sort((a, b) => b.score - a.score);

  // 4. Fetch WeeklyStats
  let weeklyPracticeMinutes = 0;
  let hiringProbability = 0;
  try {
    const statsDoc = await weeklyStatsRef(db, uid, weekStart).get();
    if (statsDoc.exists) {
      const statsData = statsDoc.data();
      weeklyPracticeMinutes = statsData?.practiceMinutes ?? 0;
      hiringProbability = statsData?.hiringProbability ?? 0;
    }
  } catch (err: any) {
    logger.warn(`[WeeklyReportEmail] Failed fetching weeklyStats for ${uid}`, { error: err.message });
  }

  // Fallback / complement practice minutes from interviews duration
  const interviewMinutesSum = recentInterviews.reduce((acc, i) => acc + i.durationMinutes, 0);
  const totalPracticeMinutes = Math.max(weeklyPracticeMinutes, interviewMinutesSum);

  const interviewsCompletedCount = recentInterviews.length;
  const averageScore =
    interviewsCompletedCount > 0
      ? Math.round(recentInterviews.reduce((acc, i) => acc + i.score, 0) / interviewsCompletedCount)
      : (user.stats?.averageScore ?? 0);

  const readinessScore =
    hiringProbability > 0
      ? hiringProbability
      : (user.readinessScore ?? user.readiness?.score ?? (averageScore > 0 ? averageScore : 65));

  const readinessDelta = user.readiness?.deltaWeek ?? 0;

  // 5. Gather unique strengths and recommendations
  const strengthsSet = new Set<string>();
  const recommendationsSet = new Set<string>();
  for (const item of recentInterviews) {
    item.strengths.forEach((s) => strengthsSet.add(s));
    item.weaknesses.forEach((w) => recommendationsSet.add(w));
  }
  const topStrengths = Array.from(strengthsSet).slice(0, 4);
  const topRecommendations = Array.from(recommendationsSet).slice(0, 4);

  // 6. Fetch Active Learning Roadmap
  const roadmap: WeeklyRoadmapProgress = { hasRoadmap: false };
  try {
    const activeRoadmapDoc = await getActiveRoadmap(uid);
    if (activeRoadmapDoc && activeRoadmapDoc.weeks && activeRoadmapDoc.weeks.length > 0) {
      roadmap.hasRoadmap = true;
      roadmap.technology = activeRoadmapDoc.technology || 'Core Skills';
      roadmap.level = activeRoadmapDoc.level || 'Intermediate';
      roadmap.progressPercent = computeRoadmapProgressPercent(activeRoadmapDoc.weeks);

      const currentWeek =
        activeRoadmapDoc.weeks.find((w) => !w.isComplete && w.unlocked) ||
        activeRoadmapDoc.weeks[0];

      if (currentWeek) {
        roadmap.currentWeekNumber = currentWeek.weekNumber;
        roadmap.currentWeekTitle = currentWeek.title;
        roadmap.totalTopicsCount = currentWeek.topics.length;
        roadmap.completedTopicsCount = currentWeek.topics.filter((t) => t.isComplete).length;

        // Find next incomplete topic or subtopic
        const nextTopic = currentWeek.topics.find((t) => !t.isComplete);
        if (nextTopic) {
          const nextSubtopic = nextTopic.subtopics.find((s) => !s.isComplete);
          roadmap.nextTopicName = nextSubtopic?.name || nextTopic.name;
        }
      }
    }
  } catch {
    // No active roadmap found — fallback nicely
    roadmap.hasRoadmap = false;
  }

  // 7. Base URLs
  const rawBaseUrl =
    appConfig.frontendUrl ||
    process.env.IV_FRONTEND_URL ||
    process.env.FRONTEND_URL ||
    'https://interview-89e09.web.app';
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');

  const metrics: WeeklyActivityMetrics = {
    practiceMinutes: totalPracticeMinutes,
    interviewsCompletedCount,
    averageScore,
    readinessScore,
    readinessDelta,
    streakDays: user.streakDays ?? 0,
    currentLevel: user.gamification?.level ?? 1,
    levelName: user.gamification?.levelName ?? 'Candidate',
    currentXP: user.gamification?.currentXP ?? 0,
    topStrengths,
    topRecommendations,
  };

  return {
    uid,
    recipientEmail,
    recipientName,
    weekRangeText,
    metrics,
    recentInterviews,
    roadmap,
    dashboardUrl: `${baseUrl}/home`,
    interviewPracticeUrl: `${baseUrl}/interviews`,
    learningRoadmapUrl: `${baseUrl}/learning`,
    settingsUrl: `${baseUrl}/settings`,
  };
}

// ─── Email Template Rendering ───────────────────────────────────────────────

export function renderWeeklyProgressEmailHtml(data: WeeklyProgressReportData): string {
  const { recipientName, weekRangeText, metrics, recentInterviews, roadmap } = data;

  // Format practice duration
  const hours = Math.floor(metrics.practiceMinutes / 60);
  const mins = metrics.practiceMinutes % 60;
  const practiceTimeDisplay =
    hours > 0 ? `${hours}h ${mins > 0 ? `${mins}m` : ''}` : `${metrics.practiceMinutes} min`;

  // Trend indicator
  const deltaBadge =
    metrics.readinessDelta > 0
      ? `<span style="color:#059669;font-size:12px;font-weight:700;margin-left:4px;">+${metrics.readinessDelta}% this week</span>`
      : '';

  // Render interview sessions cards
  let interviewsHtml = '';
  if (recentInterviews.length > 0) {
    const rows = recentInterviews
      .slice(0, 3)
      .map(
        (i) => `
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 18px;margin-bottom:12px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td valign="top" style="vertical-align:top;">
                <div style="font-weight:700;font-size:14px;color:#1e293b;line-height:1.3;">${i.title}</div>
                <div style="font-size:12px;color:#64748b;margin-top:4px;">
                  <span>${i.dateStr}</span> &bull; <span>${i.durationMinutes} min</span>
                </div>
              </td>
              <td align="right" valign="top" style="vertical-align:top;width:75px;">
                <div style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:13px;font-weight:700;background:${
                  i.score >= 75 ? '#ecfdf5' : i.score >= 50 ? '#eff6ff' : '#fef2f2'
                };color:${
                  i.score >= 75 ? '#059669' : i.score >= 50 ? '#2563eb' : '#dc2626'
                };border:1px solid ${
                  i.score >= 75 ? '#a7f3d0' : i.score >= 50 ? '#bfdbfe' : '#fecaca'
                };">
                  ${i.score}%
                </div>
              </td>
            </tr>
          </table>
        </div>`,
      )
      .join('');

    interviewsHtml = `
      <div style="margin-top:24px;">
        <h3 style="margin:0 0 12px;font-size:15px;color:#0f172a;font-weight:700;letter-spacing:-0.2px;">
          🎯 Mock Interview Highlights (${recentInterviews.length} completed)
        </h3>
        ${rows}
      </div>`;
  } else {
    interviewsHtml = `
      <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:18px 20px;margin-top:24px;text-align:left;">
        <div style="font-weight:700;font-size:14px;color:#5b21b6;margin-bottom:4px;">
          🎯 Ready for a practice interview?
        </div>
        <p style="margin:0 0 12px;font-size:13px;color:#6b21a8;line-height:1.5;">
          You didn't complete any mock interviews this week. Consistent interview simulation is the proven path to landing top offers.
        </p>
        <a href="${data.interviewPracticeUrl}" target="_blank" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;">
          Start a 15-Min Mock Interview &rarr;
        </a>
      </div>`;
  }

  // Render roadmap progress
  let roadmapHtml = '';
  if (roadmap.hasRoadmap) {
    roadmapHtml = `
      <div style="margin-top:24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <div style="font-size:12px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:0.5px;">
                Learning Roadmap &bull; ${roadmap.technology}
              </div>
              <div style="font-size:15px;font-weight:700;color:#0f172a;margin-top:2px;">
                Week ${roadmap.currentWeekNumber || 1}: ${roadmap.currentWeekTitle || 'In Progress'}
              </div>
            </td>
            <td align="right" style="vertical-align:top;">
              <span style="font-size:15px;font-weight:700;color:#4f46e5;">${roadmap.progressPercent}%</span>
            </td>
          </tr>
        </table>

        <!-- Progress bar -->
        <div style="margin-top:10px;height:8px;border-radius:999px;background:#e2e8f0;overflow:hidden;">
          <div style="height:100%;border-radius:999px;background:linear-gradient(90deg,#4f46e5,#7c3aed);width:${roadmap.progressPercent}%;"></div>
        </div>

        ${
          roadmap.nextTopicName
            ? `<div style="margin-top:10px;font-size:12px;color:#64748b;">
                <strong>Next to learn:</strong> ${roadmap.nextTopicName}
              </div>`
            : ''
        }

        <div style="margin-top:14px;">
          <a href="${data.learningRoadmapUrl}" target="_blank" style="color:#4f46e5;font-size:13px;font-weight:600;text-decoration:none;">
            Continue Roadmap &rarr;
          </a>
        </div>
      </div>`;
  } else {
    roadmapHtml = `
      <div style="margin-top:20px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:16px 20px;">
        <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:4px;">
          🗺️ Personalize Your Learning Track
        </div>
        <p style="margin:0 0 10px;font-size:12.5px;color:#64748b;line-height:1.5;">
          Get a structured 4-week preparation plan with interactive lessons and milestone check-ins tailored to your target job.
        </p>
        <a href="${data.learningRoadmapUrl}" target="_blank" style="color:#4f46e5;font-size:13px;font-weight:600;text-decoration:none;">
          Generate AI Roadmap &rarr;
        </a>
      </div>`;
  }

  // Render strengths & recommendations
  let insightsHtml = '';
  if (metrics.topStrengths.length > 0 || metrics.topRecommendations.length > 0) {
    const strengthsItems = metrics.topStrengths
      .map((s) => `<li style="margin-bottom:6px;font-size:13px;color:#334155;line-height:1.4;">${s}</li>`)
      .join('');

    const recommendationsItems = metrics.topRecommendations
      .map((r) => `<li style="margin-bottom:6px;font-size:13px;color:#334155;line-height:1.4;">${r}</li>`)
      .join('');

    insightsHtml = `
      <div style="margin-top:24px;border-top:1px solid #f1f5f9;padding-top:20px;">
        <h3 style="margin:0 0 12px;font-size:15px;color:#0f172a;font-weight:700;">
          💡 Weekly Coaching Insights
        </h3>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            ${
              metrics.topStrengths.length > 0
                ? `<td width="50%" valign="top" style="padding-right:10px;">
                    <div style="font-size:12px;font-weight:700;color:#059669;margin-bottom:6px;text-transform:uppercase;">Key Strengths</div>
                    <ul style="margin:0;padding-left:18px;color:#059669;">
                      ${strengthsItems}
                    </ul>
                  </td>`
                : ''
            }
            ${
              metrics.topRecommendations.length > 0
                ? `<td width="${metrics.topStrengths.length > 0 ? '50%' : '100%'}" valign="top" style="padding-left:10px;">
                    <div style="font-size:12px;font-weight:700;color:#6366f1;margin-bottom:6px;text-transform:uppercase;">Focus Areas for Next Week</div>
                    <ul style="margin:0;padding-left:18px;color:#6366f1;">
                      ${recommendationsItems}
                    </ul>
                  </td>`
                : ''
            }
          </tr>
        </table>
      </div>`;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Weekly Interview & Learning Progress</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">

  <!-- Hidden Preheader -->
  <div style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    Here's your weekly InterviewUp report: ${metrics.interviewsCompletedCount} mock interviews, ${practiceTimeDisplay} practice, and readiness score ${metrics.readinessScore}%.
  </div>

  <div style="max-width:620px;margin:30px auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 6px 24px rgba(15,23,42,0.06);border:1px solid #e2e8f0;">
    
    <!-- Gradient Header -->
    <div style="background:linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%);padding:28px 36px;color:#ffffff;">
      <div style="display:inline-block;background:rgba(255,255,255,0.2);padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">
        ${weekRangeText}
      </div>
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.4px;">InterviewUp</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,0.92);font-size:14px;font-weight:500;">
        Weekly Interview &amp; Skill Report
      </p>
    </div>

    <!-- Body Container -->
    <div style="padding:32px 36px;">
      <p style="margin:0 0 16px;color:#1e293b;font-size:16px;line-height:1.5;">
        Hi <strong>${recipientName}</strong>,
      </p>
      <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">
        Here is your personalized weekly summary of mock interview assessments, learning roadmap progress, and coaching recommendations.
      </p>

      <!-- 3 Stat Metric Tiles -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
        <tr>
          <!-- Practice Minutes -->
          <td width="33.33%" style="padding-right:6px;" valign="top">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 12px;text-align:center;">
              <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Practice Time</div>
              <div style="font-size:20px;font-weight:800;color:#0f172a;margin-top:4px;">${practiceTimeDisplay}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Past 7 days</div>
            </div>
          </td>
          <!-- Interviews Completed -->
          <td width="33.33%" style="padding-left:3px;padding-right:3px;" valign="top">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 12px;text-align:center;">
              <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Mock Interviews</div>
              <div style="font-size:20px;font-weight:800;color:#0f172a;margin-top:4px;">${metrics.interviewsCompletedCount}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${metrics.averageScore > 0 ? `Avg: ${metrics.averageScore}%` : 'Sessions'}</div>
            </div>
          </td>
          <!-- Readiness Score -->
          <td width="33.33%" style="padding-left:6px;" valign="top">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 12px;text-align:center;">
              <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Readiness Score</div>
              <div style="font-size:20px;font-weight:800;color:#4f46e5;margin-top:4px;">
                ${metrics.readinessScore}% ${deltaBadge}
              </div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Hiring probability</div>
            </div>
          </td>
        </tr>
      </table>

      <!-- Interview Highlights Section -->
      ${interviewsHtml}

      <!-- Roadmap Section -->
      ${roadmapHtml}

      <!-- Coaching Insights Section -->
      ${insightsHtml}

      <!-- Primary CTA Button -->
      <div style="text-align:center;margin-top:36px;margin-bottom:12px;">
        <a href="${data.dashboardUrl}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%);color:#ffffff;text-decoration:none;padding:14px 38px;border-radius:10px;font-size:14px;font-weight:700;letter-spacing:0.2px;box-shadow:0 4px 12px rgba(79,70,229,0.25);">
          Open InterviewUp &amp; Practice
        </a>
      </div>

    </div>

    <!-- Compliant Footer -->
    <div style="background:#f8fafc;padding:24px 36px;border-top:1px solid #e2e8f0;text-align:center;">
      <p style="margin:0 0 6px;color:#64748b;font-size:12px;font-weight:600;">InterviewUp AI Preparation Platform</p>
      <p style="margin:0 0 8px;color:#94a3b8;font-size:11px;line-height:1.5;">
        You received this reminder because Weekly Progress Email is turned on in your settings.
        You can update your preferences anytime in <a href="${data.settingsUrl}" style="color:#4f46e5;text-decoration:underline;">Settings</a>.
      </p>
      <p style="margin:0;color:#cbd5e1;font-size:10px;">
        &copy; 2026 InterviewUp. All rights reserved.
      </p>
    </div>

  </div>
</body>
</html>`.trim();
}

export function renderWeeklyProgressEmailText(data: WeeklyProgressReportData): string {
  const { recipientName, weekRangeText, metrics, recentInterviews, roadmap } = data;

  const hours = Math.floor(metrics.practiceMinutes / 60);
  const mins = metrics.practiceMinutes % 60;
  const practiceTimeDisplay =
    hours > 0 ? `${hours}h ${mins > 0 ? `${mins}m` : ''}` : `${metrics.practiceMinutes} min`;

  let interviewsText = '';
  if (recentInterviews.length > 0) {
    interviewsText = `
MOCK INTERVIEW HIGHLIGHTS (${recentInterviews.length} completed):
${recentInterviews
  .map((i) => `• ${i.title} - ${i.score}% (${i.durationMinutes} min on ${i.dateStr})`)
  .join('\n')}
`.trim();
  } else {
    interviewsText = `
MOCK INTERVIEWS:
You didn't complete any mock interviews this week. Take 15 minutes to sharpen your skills:
${data.interviewPracticeUrl}
`.trim();
  }

  let roadmapText = '';
  if (roadmap.hasRoadmap) {
    roadmapText = `
LEARNING ROADMAP (${roadmap.technology}):
Progress: ${roadmap.progressPercent}%
Current Week ${roadmap.currentWeekNumber}: ${roadmap.currentWeekTitle}
${roadmap.nextTopicName ? `Next to learn: ${roadmap.nextTopicName}` : ''}
Link: ${data.learningRoadmapUrl}
`.trim();
  }

  return `
Hi ${recipientName},

Here is your weekly InterviewUp progress summary for ${weekRangeText}:

WEEKLY HIGHLIGHTS:
• Practice Time: ${practiceTimeDisplay}
• Mock Interviews Completed: ${metrics.interviewsCompletedCount} (Avg Score: ${metrics.averageScore}%)
• Readiness Score: ${metrics.readinessScore}%

${interviewsText}

${roadmapText}

Continue your preparation on InterviewUp:
${data.dashboardUrl}

--
You received this email because Weekly Progress Email is enabled in your settings.
Manage your email preferences: ${data.settingsUrl}
© 2026 InterviewUp. All rights reserved.
`.trim();
}

// ─── Single User Dispatcher ─────────────────────────────────────────────────

export async function findUserByEmail(email: string): Promise<any | null> {
  const db = ensureAdmin();
  const cleanEmail = email.trim().toLowerCase();
  let snap = await db.collection('users').where('email', '==', cleanEmail).limit(1).get();
  if (snap.empty) {
    snap = await db.collection('users').where('email', '==', email.trim()).limit(1).get();
  }
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...(doc.data() || {}) };
}

export async function sendWeeklyProgressEmailForUser(
  uid: string,
  options?: { force?: boolean; recipientEmailOverride?: string },
): Promise<{ success: boolean; messageId?: string; reason?: string; recipientEmail?: string }> {
  const db = ensureAdmin();
  const userDoc = await db.collection('users').doc(uid).get();

  if (!userDoc.exists) {
    return { success: false, reason: 'user_not_found' };
  }

  const user: any = { id: userDoc.id, ...(userDoc.data() || {}) };

  if (user.isActive === false || user.isDeleted === true) {
    return { success: false, reason: 'user_inactive' };
  }

  if (!options?.force && !isWeeklyProgressEmailEnabled(user)) {
    return { success: false, reason: 'opted_out' };
  }

  const reportData = await buildWeeklyProgressReportData(uid, user);
  if (!reportData) {
    return { success: false, reason: 'no_valid_email_or_data' };
  }

  const toEmail = options?.recipientEmailOverride?.trim() || reportData.recipientEmail;
  const html = renderWeeklyProgressEmailHtml(reportData);
  const text = renderWeeklyProgressEmailText(reportData);
  const subject = `Your Weekly InterviewUp Report: ${reportData.metrics.interviewsCompletedCount} Sessions · ${reportData.metrics.readinessScore}% Readiness 🚀`;

  const messageId = await sendEmail({
    to: toEmail,
    subject,
    html,
    text,
  });

  return { success: true, messageId, recipientEmail: toEmail };
}

// ─── Batch Processor (Scheduled or Admin-Triggered) ─────────────────────────

export async function sendWeeklyProgressReportsToAllUsers(
  options?: { dryRun?: boolean; limit?: number },
): Promise<BatchSendResult> {
  const db = ensureAdmin();
  const dryRun = options?.dryRun === true;
  const maxToProcess = options?.limit ?? 5000;

  const result: BatchSendResult = {
    totalScanned: 0,
    eligibleCount: 0,
    sentCount: 0,
    failedCount: 0,
    skippedOptOutCount: 0,
    skippedNoEmailCount: 0,
    dryRun,
    errors: [],
  };

  logger.info(`[WeeklyReportEmail] Starting weekly report batch (dryRun=${dryRun}, max=${maxToProcess})...`);

  const BATCH_SIZE = 100;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  while (result.totalScanned < maxToProcess) {
    let query = db.collection('users').orderBy('__name__').limit(BATCH_SIZE);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snap = await query.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      result.totalScanned++;
      const user: any = { id: doc.id, ...(doc.data() || {}) };

      if (user.isActive === false || user.isDeleted === true) {
        continue;
      }

      const email = (user.email || '').trim();
      if (!email || !email.includes('@')) {
        result.skippedNoEmailCount++;
        continue;
      }

      if (!isWeeklyProgressEmailEnabled(user)) {
        result.skippedOptOutCount++;
        continue;
      }

      result.eligibleCount++;

      if (dryRun) {
        result.sentCount++;
        continue;
      }

      try {
        const sendRes = await sendWeeklyProgressEmailForUser(doc.id, { force: false });
        if (sendRes.success) {
          result.sentCount++;
        } else {
          result.failedCount++;
          result.errors?.push({ uid: doc.id, email, error: sendRes.reason || 'send_failed' });
        }
      } catch (err: any) {
        result.failedCount++;
        result.errors?.push({ uid: doc.id, email, error: err.message });
        logger.error(`[WeeklyReportEmail] Error sending to ${email} (uid: ${doc.id})`, {
          error: err.message,
        });
      }
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < BATCH_SIZE) break;
  }

  logger.info(
    `[WeeklyReportEmail] Finished batch: Scanned=${result.totalScanned}, Eligible=${result.eligibleCount}, Sent=${result.sentCount}, OptOut=${result.skippedOptOutCount}, NoEmail=${result.skippedNoEmailCount}, Failed=${result.failedCount}`,
  );

  return result;
}
