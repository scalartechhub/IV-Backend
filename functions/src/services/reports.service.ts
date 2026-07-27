/**
 * Reports summary for /reports UI — reads pre-aggregated weeklyStats.
 */

import type { WeeklyStatsDoc } from '../interfaces/report.interface';
import { AppError } from '../shared/utils';
import { ensureAdmin } from '../utils/callable-auth';
import { formatDate, getWeekStart, subDays } from '../utils/date-helpers';
import { reportsCol, weeklyStatsCol } from '../utils/firestore-refs';

const TREND_WEEKS = 6;
const HEATMAP_DAYS = 84;

export interface ReportsSummaryResponse {
  metrics: Array<{
    label: 'Technical' | 'Communication' | 'Confidence' | 'Hiring Probability';
    value: number;
    delta: number;
  }>;
  skillTrends: Array<{
    weekStart: string;
    weekLabel: string;
    technical: number;
    communication: number;
    confidence: number;
    hiring: number;
  }>;
  radar: Array<{ skill: string; value: number }>;
  heatmap: Array<{ date: string; sessions: number }>;
}

function weekLabel(weekStart: string): string {
  const parsed = new Date(`${weekStart}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return weekStart;
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function round(n: number): number {
  return Math.round(n);
}

function delta(current: number, previous: number | undefined): number {
  if (previous === undefined) return 0;
  return Math.max(0, round(current - previous));
}

function emptyWeek(weekStart: string): WeeklyStatsDoc {
  return {
    weekStart,
    technical: 0,
    communication: 0,
    confidence: 0,
    problemSolving: 0,
    coding: 0,
    behavior: 0,
    hiringProbability: 0,
    interviewsCompleted: 0,
    practiceMinutes: 0,
    practiceMinutesByDay: {},
    sessionsByDay: {},
  };
}

/**
 * Build the full Reports page payload from weeklyStats (last ~12 weeks).
 */
export async function getReportsSummary(
  uid: string,
): Promise<ReportsSummaryResponse> {
  const db = ensureAdmin();
  const now = new Date();
  const currentWeekStart = getWeekStart(now);

  const snap = await weeklyStatsCol(db, uid)
    .orderBy('weekStart', 'desc')
    .limit(14)
    .get();

  const byWeek = new Map<string, WeeklyStatsDoc>();
  for (const doc of snap.docs) {
    byWeek.set(doc.id, doc.data() as WeeklyStatsDoc);
  }

  const orderedTrendStarts: string[] = [];
  const weekAnchor = new Date(`${currentWeekStart}T00:00:00.000Z`);
  for (let i = TREND_WEEKS - 1; i >= 0; i -= 1) {
    orderedTrendStarts.push(formatDate(subDays(weekAnchor, i * 7)));
  }

  const trendDocs = orderedTrendStarts.map(
    (ws) => byWeek.get(ws) ?? emptyWeek(ws),
  );

  const latest = trendDocs[trendDocs.length - 1];
  const previous =
    trendDocs.length > 1 ? trendDocs[trendDocs.length - 2] : undefined;

  const metrics: ReportsSummaryResponse['metrics'] = [
    {
      label: 'Technical',
      value: round(latest.technical),
      delta: delta(latest.technical, previous?.technical),
    },
    {
      label: 'Communication',
      value: round(latest.communication),
      delta: delta(latest.communication, previous?.communication),
    },
    {
      label: 'Confidence',
      value: round(latest.confidence),
      delta: delta(latest.confidence, previous?.confidence),
    },
    {
      label: 'Hiring Probability',
      value: round(latest.hiringProbability),
      delta: delta(latest.hiringProbability, previous?.hiringProbability),
    },
  ];

  const skillTrends = trendDocs.map((doc) => ({
    weekStart: doc.weekStart,
    weekLabel: weekLabel(doc.weekStart),
    technical: round(doc.technical),
    communication: round(doc.communication),
    confidence: round(doc.confidence),
    hiring: round(doc.hiringProbability),
  }));

  const radar = [
    { skill: 'Technical', value: round(latest.technical) },
    { skill: 'Comm.', value: round(latest.communication) },
    { skill: 'Confidence', value: round(latest.confidence) },
    { skill: 'Problem Solving', value: round(latest.problemSolving) },
    { skill: 'Coding', value: round(latest.coding) },
    { skill: 'Behavior', value: round(latest.behavior) },
  ];

  const sessionCounts = new Map<string, number>();
  for (const doc of byWeek.values()) {
    for (const [date, count] of Object.entries(doc.sessionsByDay ?? {})) {
      sessionCounts.set(date, (sessionCounts.get(date) ?? 0) + count);
    }
  }

  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const heatmap: ReportsSummaryResponse['heatmap'] = [];
  for (let i = HEATMAP_DAYS - 1; i >= 0; i -= 1) {
    const key = formatDate(subDays(today, i));
    heatmap.push({ date: key, sessions: sessionCounts.get(key) ?? 0 });
  }

  return { metrics, skillTrends, radar, heatmap };
}

export async function listReports(uid: string, limit = 20) {
  const db = ensureAdmin();
  const snap = await reportsCol(db, uid)
    .orderBy('generatedAt', 'desc')
    .limit(Math.min(limit, 50))
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getReport(uid: string, reportId: string) {
  const db = ensureAdmin();
  const snap = await reportsCol(db, uid).doc(reportId).get();
  if (!snap.exists) throw new AppError(404, 'Report not found.');
  return { id: snap.id, ...snap.data() };
}
