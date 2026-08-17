/**
 * Career progress: peer benchmarks, salary insights, milestones.
 * Written to users/{uid}/careerProgress/current by the nightly job and
 * refreshed after each completed interview.
 */

import { FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import type { CareerProgressDoc } from '../interfaces/career-progress.interface';
import type { InterviewResults } from '../interfaces/interview.interface';
import type { UserDoc } from '../interfaces/user.interface';
import { careerProgressRef, reportsCol, skillRef, userRef } from '../utils/firestore-refs';
import { ensureAdmin } from '../utils/callable-auth';
import { AppError } from '../shared/utils';

const SKILL_KEYS = [
  'technical',
  'communication',
  'confidence',
  'problemSolving',
  'coding',
  'behavior',
] as const;

type SkillKey = (typeof SKILL_KEYS)[number];

/** Loose user shape for career progress (flat + nested fields may both exist). */
type CareerUser = UserDoc & {
  targetRole?: string;
  totalInterviews?: number;
  readinessScore?: number;
  readinessDeltaThisWeek?: number;
  peerComparisonPercent?: number;
};

function clamp(n: number, min = 0, max = 100): number {
  return Math.round(Math.min(max, Math.max(min, n)));
}

/** Firestore rejects `undefined` field values — drop them before writes. */
function omitUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => omitUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      output[key] = omitUndefinedDeep(item);
    }
    return output as T;
  }
  return value;
}

function readinessLabel(score: number): string {
  if (score >= 85) return 'Ready for senior roles';
  if (score >= 70) return 'Ready for mid-senior roles';
  if (score >= 50) return 'Building toward mid-level roles';
  if (score > 0) return 'Early career — keep practicing';
  return 'Complete interviews to unlock readiness';
}

function improvingLabel(delta: number, interviews: number): string | undefined {
  if (interviews < 2) return undefined;
  if (delta >= 8) return 'Fast Improving';
  if (delta > 0) return 'Improving';
  return undefined;
}

function lpaToInr(lpa: number): number {
  return Math.round(lpa * 100_000);
}

function salaryBand(readiness: number): {
  minLpa: number;
  maxLpa: number;
  marketMin: number;
  marketMax: number;
} {
  if (readiness >= 85) return { minLpa: 28, maxLpa: 40, marketMin: 6, marketMax: 45 };
  if (readiness >= 70) return { minLpa: 18, maxLpa: 28, marketMin: 6, marketMax: 45 };
  if (readiness >= 50) return { minLpa: 10, maxLpa: 18, marketMin: 6, marketMax: 45 };
  return { minLpa: 6, maxLpa: 12, marketMin: 6, marketMax: 45 };
}

function resolveRole(user: CareerUser): string {
  const profile = user.profile as { targetRole?: string } | undefined;
  const onboarding = user.onboarding as { selectedRole?: string } | undefined;
  return (
    profile?.targetRole?.trim() ||
    user.targetRole?.trim() ||
    onboarding?.selectedRole?.trim() ||
    'General'
  );
}

function resolveCompanies(user: CareerUser): string[] {
  const onboarding = user.onboarding as { targetCompanies?: string[] } | undefined;
  const profile = user.profile as { targetCompanies?: string[] | string } | undefined;
  if (Array.isArray(onboarding?.targetCompanies) && onboarding.targetCompanies.length) {
    return onboarding.targetCompanies.slice(0, 3);
  }
  if (Array.isArray(profile?.targetCompanies)) {
    return profile.targetCompanies.slice(0, 3);
  }
  if (typeof profile?.targetCompanies === 'string' && profile.targetCompanies.trim()) {
    return profile.targetCompanies.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3);
  }
  return [];
}

function resolveInterviewCount(user: CareerUser): number {
  return Math.max(user.stats?.totalInterviews ?? 0, user.totalInterviews ?? 0);
}

/** Reuse cohort peer averages computed within this window instead of rescanning users. */
const PEER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Cap how many candidate users are read when sampling a role cohort. */
const PEER_CANDIDATE_LIMIT = 300;
/** Stop sampling once enough peers have scored skills — averages stabilize well before this. */
const PEER_SAMPLE_TARGET = 60;

function isRecentTimestamp(value: unknown, maxAgeMs: number): boolean {
  const ts = value as { toMillis?: () => number; seconds?: number } | undefined;
  const millis =
    typeof ts?.toMillis === 'function'
      ? ts.toMillis()
      : typeof ts?.seconds === 'number'
        ? ts.seconds * 1000
        : undefined;
  if (millis === undefined) return false;
  return Date.now() - millis < maxAgeMs;
}

/** Skill scores for "You". Reports page source when preferReports is set. */
async function loadYouScores(
  db: Firestore,
  uid: string,
  user?: CareerUser,
  preferReports = false,
): Promise<Record<SkillKey, number>> {
  if (preferReports) {
    const reportSnap = await reportsCol(db, uid)
      .orderBy('generatedAt', 'desc')
      .limit(5)
      .get();

    if (!reportSnap.empty) {
      const sums: Record<string, number> = {};
      const counts: Record<string, number> = {};
      for (const doc of reportSnap.docs) {
        const breakdown = (doc.data() as {
          charts?: { skillBreakdown?: Record<string, number> };
        }).charts?.skillBreakdown;
        if (!breakdown) continue;
        for (const key of SKILL_KEYS) {
          const raw = breakdown[key];
          const fallback =
            key === 'coding'
              ? breakdown.technical
              : key === 'behavior'
                ? breakdown.communication
                : undefined;
          const value = typeof raw === 'number' ? raw : fallback;
          if (typeof value !== 'number' || !Number.isFinite(value)) continue;
          sums[key] = (sums[key] ?? 0) + value;
          counts[key] = (counts[key] ?? 0) + 1;
        }
      }
      const you = {} as Record<SkillKey, number>;
      for (const key of SKILL_KEYS) {
        const count = counts[key] ?? 0;
        you[key] = count > 0 ? clamp((sums[key] ?? 0) / count) : 0;
      }
      return you;
    }
  }

  const you = {} as Record<SkillKey, number>;
  const hasSignals = !!user?.skillSignals;
  const snaps = hasSignals
    ? []
    : await Promise.all(SKILL_KEYS.map((key) => skillRef(db, uid, key).get()));
  for (let i = 0; i < SKILL_KEYS.length; i += 1) {
    const key = SKILL_KEYS[i];
    const signal = user?.skillSignals?.[key];
    if (typeof signal === 'number' && Number.isFinite(signal)) {
      you[key] = clamp(signal);
      continue;
    }
    const skillScore = snaps[i]?.exists ? snaps[i].data()?.score : undefined;
    if (typeof skillScore === 'number' && Number.isFinite(skillScore)) {
      you[key] = clamp(skillScore);
    } else {
      you[key] = 0;
    }
  }
  return you;
}

/** Weighted readiness.score — never skillSignals.totalScore (that averages untested skills as 0). */
function resolveReadiness(user: CareerUser): number {
  const nested = user.readiness?.score;
  if (typeof nested === 'number' && Number.isFinite(nested) && nested > 0) {
    return clamp(nested);
  }
  if (typeof user.readinessScore === 'number' && user.readinessScore > 0) {
    return clamp(user.readinessScore);
  }
  return 0;
}

function peerComparisonPercent(
  you: Record<SkillKey, number>,
  peerAvg: Record<string, number>,
): number {
  const keys = SKILL_KEYS.filter((key) => (you[key] ?? 0) > 0);
  const sample = keys.length > 0 ? keys : [...SKILL_KEYS];
  const deltas = sample.map((key) => {
    const y = you[key] ?? 0;
    const avg = peerAvg[key] ?? 50;
    return Math.min(95, Math.max(5, 50 + (y - avg) * 1.25));
  });
  return clamp(deltas.reduce((sum, n) => sum + n, 0) / deltas.length);
}

interface InterviewMilestoneStats {
  successful: number;
  bestTechnical: number;
  bestCoding: number;
}

/** Count 70+ interviews and best raw scores from interviews + reports. */
async function loadInterviewMilestoneStats(
  db: Firestore,
  uid: string,
): Promise<InterviewMilestoneStats> {
  const [interviewSnap, reportSnap] = await Promise.all([
    db
      .collection('interviews')
      .where('userId', '==', uid)
      .where('status', '==', 'completed')
      .select('results')
      .get(),
    reportsCol(db, uid).select('interviewId', 'charts').get(),
  ]);

  const byInterview = new Map<
    string,
    { overall: number; technical: number; coding: number }
  >();

  const take = (
    id: string,
    overall?: number,
    technical?: number,
    coding?: number,
  ) => {
    const prev = byInterview.get(id) ?? { overall: 0, technical: 0, coding: 0 };
    byInterview.set(id, {
      overall: Math.max(
        prev.overall,
        typeof overall === 'number' && Number.isFinite(overall) ? overall : 0,
      ),
      technical: Math.max(
        prev.technical,
        typeof technical === 'number' && Number.isFinite(technical) ? technical : 0,
      ),
      coding: Math.max(
        prev.coding,
        typeof coding === 'number' && Number.isFinite(coding) ? coding : 0,
      ),
    });
  };

  for (const doc of interviewSnap.docs) {
    const results = doc.data().results as InterviewResults | undefined;
    take(
      doc.id,
      results?.overallScore,
      results?.technicalScore,
      results?.codingScore,
    );
  }

  for (const doc of reportSnap.docs) {
    const data = doc.data() as {
      interviewId?: string;
      charts?: {
        skillBreakdown?: { technical?: number; coding?: number };
        timeline?: Array<{ score?: number }>;
      };
    };
    const interviewId = data.interviewId || doc.id;
    take(
      interviewId,
      data.charts?.timeline?.[0]?.score,
      data.charts?.skillBreakdown?.technical,
      data.charts?.skillBreakdown?.coding,
    );
  }

  let successful = 0;
  let bestTechnical = 0;
  let bestCoding = 0;
  for (const row of byInterview.values()) {
    if (row.overall >= 70) successful += 1;
    bestTechnical = Math.max(bestTechnical, row.technical);
    bestCoding = Math.max(bestCoding, row.coding);
  }

  return { successful, bestTechnical, bestCoding };
}

function buildMilestones(
  user: CareerUser,
  interviewStats: InterviewMilestoneStats,
): CareerProgressDoc['milestones'] {
  const interviews = resolveInterviewCount(user);

  return [
    {
      id: 'interviews_5',
      title: 'Complete 5 practice interviews',
      targetValue: 5,
      currentValue: Math.min(5, interviews),
      unlocksLevel: 'Developer',
    },
    {
      id: 'technical_80',
      title: 'Reach 80+ technical score',
      targetValue: 80,
      currentValue: Math.min(80, interviewStats.bestTechnical),
      unlocksLevel: 'Senior Developer',
    },
    {
      id: 'coding_75',
      title: 'Reach 75+ coding score',
      targetValue: 75,
      currentValue: Math.min(75, interviewStats.bestCoding),
      unlocksLevel: 'Senior Developer',
    },
    {
      id: 'successful_3',
      title: 'Score 70+ on 3 interviews',
      targetValue: 3,
      currentValue: Math.min(3, interviewStats.successful),
      unlocksLevel: 'Senior Developer',
    },
  ];
}

function buildSalaryInsights(
  user: CareerUser,
  readiness: number,
  you: Record<SkillKey, number>,
): CareerProgressDoc['salaryInsights'] {
  const band = salaryBand(readiness);
  const positionInRange = Math.min(1, Math.max(0, readiness / 100));

  const ranked = [...SKILL_KEYS].sort((a, b) => (you[b] ?? 0) - (you[a] ?? 0));
  const onboarding = user.onboarding as {
    learningPriorities?: string[];
    primarySkills?: string[];
  } | undefined;
  const mostRequested =
    onboarding?.learningPriorities?.[0] ||
    onboarding?.primarySkills?.[0] ||
    ranked[0] ||
    'Angular';

  return {
    currency: 'INR',
    expectedRangeMin: lpaToInr(band.minLpa),
    expectedRangeMax: lpaToInr(band.maxLpa),
    positionInRange,
    mostRequestedSkill: mostRequested,
    fastestImprovingSkill: {
      name: ranked[0] ?? 'communication',
      deltaPercent: 0,
    },
    regionLabel: 'India',
    regionFlag: '🇮🇳',
  };
}

async function computePeerAveragesFromUids(
  db: Firestore,
  uids: string[],
): Promise<{ peerAvg: Record<string, number>; sampleSize: number }> {
  const skillSums: Record<string, number> = {};
  const skillCounts: Record<string, number> = {};
  let sampleSize = 0;

  for (const uid of uids) {
    if (sampleSize >= PEER_SAMPLE_TARGET) break;
    const you = await loadYouScores(db, uid);
    if (!SKILL_KEYS.some((key) => you[key] > 0)) continue;
    sampleSize += 1;
    for (const key of SKILL_KEYS) {
      if (you[key] <= 0) continue;
      skillSums[key] = (skillSums[key] ?? 0) + you[key];
      skillCounts[key] = (skillCounts[key] ?? 0) + 1;
    }
  }

  const peerAvg: Record<string, number> = {};
  for (const key of SKILL_KEYS) {
    const count = skillCounts[key] ?? 0;
    peerAvg[key] = count > 0 ? Math.round((skillSums[key] ?? 0) / count) : 50;
  }

  return { peerAvg, sampleSize };
}

async function loadPeerAveragesForRole(
  db: Firestore,
  role: string,
): Promise<{ peerAvg: Record<string, number>; sampleSize: number }> {
  // Bounded scan — role isn't a single indexed field (it can live in profile.targetRole,
  // targetRole, or onboarding.selectedRole), so we page through a capped candidate set
  // rather than the entire users collection.
  const usersSnap = await db
    .collection('users')
    .select('profile', 'onboarding', 'targetRole')
    .limit(PEER_CANDIDATE_LIMIT)
    .get();

  const uids: string[] = [];
  for (const doc of usersSnap.docs) {
    const peerRole = resolveRole({ ...doc.data(), uid: doc.id } as CareerUser);
    if (role === 'General' || peerRole === role) {
      uids.push(doc.id);
    }
  }

  return computePeerAveragesFromUids(db, uids);
}

/**
 * Recompute and write career progress for one user.
 * Safe to call after interview complete: reads the user's own skill scores fresh,
 * but reuses cohort peer averages computed within PEER_CACHE_TTL_MS (nightly job or a
 * recent refresh) instead of rescanning the users collection on every interview.
 */
export async function refreshCareerProgressForUser(uid: string): Promise<CareerProgressDoc | null> {
  const db = ensureAdmin();
  const snap = await userRef(db, uid).get();
  if (!snap.exists) return null;

  const user = { uid, ...snap.data() } as CareerUser;
  const role = resolveRole(user);
  const companies = resolveCompanies(user);
  const you = await loadYouScores(db, uid, user, true);
  const readiness = resolveReadiness(user);
  const interviews = resolveInterviewCount(user);
  const interviewStats = await loadInterviewMilestoneStats(db, uid);

  const existing = await careerProgressRef(db, uid).get();
  const existingData = existing.exists ? (existing.data() as CareerProgressDoc) : null;
  const cacheIsFresh =
    !!existingData?.lastComputedAt &&
    isRecentTimestamp(existingData.lastComputedAt, PEER_CACHE_TTL_MS);

  let peerAvg: Record<string, number>;
  let cohortSize: number;
  if (cacheIsFresh && existingData) {
    peerAvg = {};
    for (const key of SKILL_KEYS) {
      peerAvg[key] = existingData.peerBenchmark?.scores?.[key]?.peerAvg ?? 50;
    }
    cohortSize = Math.max(1, existingData.peerBenchmark?.cohortSize ?? 1);
  } else {
    const loaded = await loadPeerAveragesForRole(db, role);
    peerAvg = loaded.peerAvg;
    cohortSize = Math.max(1, loaded.sampleSize);
  }

  const scores: CareerProgressDoc['peerBenchmark']['scores'] = {};
  for (const key of SKILL_KEYS) {
    scores[key] = {
      you: you[key],
      peerAvg: peerAvg[key] ?? 50,
    };
  }

  const comparison = peerComparisonPercent(you, peerAvg);
  const deltaWeek = user.readiness?.deltaWeek ?? user.readinessDeltaThisWeek ?? 0;

  const cohortLabel =
    companies.length > 0
      ? `${role} targeting ${companies.join(', ')}`
      : `${role} cohort`;

  const progress: CareerProgressDoc = {
    jobReadiness: readiness,
    readinessLabel: readinessLabel(readiness),
    peerComparisonPercent: comparison,
    improvingLabel: improvingLabel(deltaWeek, interviews),
    salaryInsights: buildSalaryInsights(user, readiness, you),
    peerBenchmark: {
      cohortLabel,
      cohortSize,
      scores,
    },
    milestones: buildMilestones(user, interviewStats),
    lastComputedAt: FieldValue.serverTimestamp() as never,
  };

  await careerProgressRef(db, uid).set(omitUndefinedDeep(progress), { merge: true });

  // Dual-write flat peer fields used by the dashboard home badge.
  await db.collection('users').doc(uid).set(
    {
      peerComparisonPercent: comparison,
      peerRole: role === 'General' ? 'peers' : `${role} peers`,
      readinessScore: readiness,
      'stats.successfulInterviews': interviewStats.successful,
    },
    { merge: true },
  );

  return progress;
}

/**
 * Fetch existing career progress doc for user. If it doesn't exist, compute & write it first.
 */
export async function getCareerProgress(uid: string): Promise<CareerProgressDoc> {
  const computed = await refreshCareerProgressForUser(uid);
  if (!computed) {
    throw new AppError(404, 'User profile not found.');
  }

  const db = ensureAdmin();
  const fresh = await careerProgressRef(db, uid).get();
  return (fresh.data() as CareerProgressDoc) || computed;
}

/**
 * Nightly cohort recompute: refresh peer averages for every user, then rewrite progress.
 */
export async function computeCareerProgressForAllUsers(): Promise<void> {
  const db = ensureAdmin();
  const usersSnap = await db.collection('users').select('profile', 'onboarding', 'targetRole').get();

  const byRole = new Map<string, string[]>();
  for (const doc of usersSnap.docs) {
    const data = doc.data() as CareerUser;
    const role = resolveRole({ ...data, uid: doc.id });
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role)!.push(doc.id);
  }

  for (const [role, uids] of byRole) {
    const { peerAvg, sampleSize } = await computePeerAveragesFromUids(db, uids);

    for (const uid of uids) {
      const userSnap = await userRef(db, uid).get();
      if (!userSnap.exists) continue;
      const user = { uid, ...userSnap.data() } as CareerUser;
      const you = await loadYouScores(db, uid, user, true);
      const readiness = resolveReadiness(user);
      const interviews = resolveInterviewCount(user);
      const interviewStats = await loadInterviewMilestoneStats(db, uid);
      const companies = resolveCompanies(user);
      const comparison = peerComparisonPercent(you, peerAvg);
      const deltaWeek = user.readiness?.deltaWeek ?? 0;

      const scores: CareerProgressDoc['peerBenchmark']['scores'] = {};
      for (const key of SKILL_KEYS) {
        scores[key] = { you: you[key], peerAvg: peerAvg[key] ?? 50 };
      }

      const progress: CareerProgressDoc = {
        jobReadiness: readiness,
        readinessLabel: readinessLabel(readiness),
        peerComparisonPercent: comparison,
        improvingLabel: improvingLabel(deltaWeek, interviews),
        salaryInsights: buildSalaryInsights(user, readiness, you),
        peerBenchmark: {
          cohortLabel:
            companies.length > 0
              ? `${role} targeting ${companies.join(', ')}`
              : `${role} cohort`,
          cohortSize: Math.max(uids.length, sampleSize, 1),
          scores,
        },
        milestones: buildMilestones(user, interviewStats),
        lastComputedAt: FieldValue.serverTimestamp() as never,
      };

      await careerProgressRef(db, uid).set(omitUndefinedDeep(progress), { merge: true });
      await db.collection('users').doc(uid).set(
        {
          peerComparisonPercent: comparison,
          peerRole: role === 'General' ? 'peers' : `${role} peers`,
          readinessScore: readiness,
          'stats.successfulInterviews': interviewStats.successful,
        },
        { merge: true },
      );
    }
  }
}
