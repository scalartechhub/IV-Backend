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
import { READINESS_WEIGHTS } from '../library/readiness';

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

function roleKey(role: string): string {
  return role.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isSameTargetRole(userRole: string, peerRole: string): boolean {
  const userKey = roleKey(userRole);
  const peerKey = roleKey(peerRole);
  if (userKey === 'general') return true;
  return userKey === peerKey;
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

/** Cap how many candidate users are read when sampling a role cohort. */
const PEER_CANDIDATE_LIMIT = 300;
/** Stop sampling once enough peers have scored skills — averages stabilize well before this. */
const PEER_SAMPLE_TARGET = 60;

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
          const value = typeof raw === 'number' ? raw : undefined;
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

/** Weighted readiness from tested skills only — never pad missing skills with 50. */
function readinessFromYou(you: Record<SkillKey, number>): number {
  let sum = 0;
  let weight = 0;
  for (const key of SKILL_KEYS) {
    const score = you[key] ?? 0;
    if (score <= 0) continue;
    const w = READINESS_WEIGHTS[key] ?? 0;
    sum += score * w;
    weight += w;
  }
  return weight > 0 ? clamp(sum / weight) : 0;
}

/**
 * Same source as Reports "Hiring Probability": average overall of last 5 reports.
 * Falls back to weighted skill scores from those reports (or skillSignals).
 */
async function loadCurrentPerformance(
  db: Firestore,
  uid: string,
  user?: CareerUser,
): Promise<{ you: Record<SkillKey, number>; readiness: number }> {
  const reportSnap = await reportsCol(db, uid)
    .orderBy('generatedAt', 'desc')
    .limit(5)
    .get();

  if (!reportSnap.empty) {
    const sums: Record<string, number> = {};
    const counts: Record<string, number> = {};
    const overalls: number[] = [];
    for (const doc of reportSnap.docs) {
      const data = doc.data() as {
        charts?: {
          skillBreakdown?: Record<string, number>;
          timeline?: Array<{ score?: number }>;
        };
      };
      const overall = data.charts?.timeline?.[0]?.score;
      if (typeof overall === 'number' && Number.isFinite(overall)) {
        overalls.push(overall);
      }
      const breakdown = data.charts?.skillBreakdown;
      if (!breakdown) continue;
      for (const key of SKILL_KEYS) {
        const value = breakdown[key];
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
    const hiring =
      overalls.length > 0
        ? clamp(overalls.reduce((s, n) => s + n, 0) / overalls.length)
        : readinessFromYou(you);
    return { you, readiness: hiring };
  }

  const you = await loadYouScores(db, uid, user, false);
  return { you, readiness: readinessFromYou(you) };
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

async function computePeerAveragesFromUsers(
  db: Firestore,
  peers: CareerUser[],
): Promise<{ peerAvg: Record<string, number>; sampleSize: number; cohortSize: number }> {
  const skillSums: Record<string, number> = {};
  const skillCounts: Record<string, number> = {};
  let sampleSize = 0;

  for (const peer of peers) {
    if (sampleSize >= PEER_SAMPLE_TARGET) break;
    const you = await loadYouScores(db, peer.uid, peer);
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

  return { peerAvg, sampleSize, cohortSize: Math.max(peers.length, 1) };
}

async function loadPeerAveragesForRole(
  db: Firestore,
  role: string,
): Promise<{ peerAvg: Record<string, number>; sampleSize: number; cohortSize: number }> {
  const usersSnap = await db
    .collection('users')
    .select('profile', 'onboarding', 'targetRole', 'skillSignals')
    .limit(PEER_CANDIDATE_LIMIT)
    .get();

  const peers: CareerUser[] = [];
  for (const doc of usersSnap.docs) {
    const peer = { uid: doc.id, ...doc.data() } as CareerUser;
    if (isSameTargetRole(role, resolveRole(peer))) {
      peers.push(peer);
    }
  }

  return computePeerAveragesFromUsers(db, peers);
}

/**
 * Recompute and write career progress for one user.
 * Always rescans the role cohort so a second user with the same target role
 * is counted immediately (no stale 1-person cache).
 */
export async function refreshCareerProgressForUser(uid: string): Promise<CareerProgressDoc | null> {
  const db = ensureAdmin();
  const snap = await userRef(db, uid).get();
  if (!snap.exists) return null;

  const user = { uid, ...snap.data() } as CareerUser;
  const role = resolveRole(user);
  const companies = resolveCompanies(user);
  const { you, readiness } = await loadCurrentPerformance(db, uid, user);
  const interviews = resolveInterviewCount(user);
  const interviewStats = await loadInterviewMilestoneStats(db, uid);

  const loaded = await loadPeerAveragesForRole(db, role);
  const peerAvg = loaded.peerAvg;
  const cohortSize = loaded.cohortSize;

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
      'readiness.score': readiness,
      'stats.successfulInterviews': interviewStats.successful,
    },
    { merge: true },
  );

  return progress;
}

/**
 * Nightly cohort recompute: refresh peer averages for every user, then rewrite progress.
 */
export async function computeCareerProgressForAllUsers(): Promise<void> {
  const db = ensureAdmin();
  const usersSnap = await db
    .collection('users')
    .select('profile', 'onboarding', 'targetRole', 'skillSignals')
    .get();

  const allUsers: CareerUser[] = [];
  const byRole = new Map<string, CareerUser[]>();
  const roleLabel = new Map<string, string>();

  for (const doc of usersSnap.docs) {
    const user = { uid: doc.id, ...doc.data() } as CareerUser;
    allUsers.push(user);
    const role = resolveRole(user);
    const key = roleKey(role);
    if (!byRole.has(key)) {
      byRole.set(key, []);
      roleLabel.set(key, role);
    }
    byRole.get(key)!.push(user);
  }

  for (const [key, group] of byRole) {
    const role = roleLabel.get(key) ?? 'General';
    const peers = key === 'general' ? allUsers : group;
    const { peerAvg, cohortSize } = await computePeerAveragesFromUsers(db, peers);

    for (const peer of group) {
      const userSnap = await userRef(db, peer.uid).get();
      if (!userSnap.exists) continue;
      const user = { uid: peer.uid, ...userSnap.data() } as CareerUser;
      const { you, readiness } = await loadCurrentPerformance(db, peer.uid, user);
      const interviews = resolveInterviewCount(user);
      const interviewStats = await loadInterviewMilestoneStats(db, peer.uid);
      const companies = resolveCompanies(user);
      const comparison = peerComparisonPercent(you, peerAvg);
      const deltaWeek = user.readiness?.deltaWeek ?? 0;

      const scores: CareerProgressDoc['peerBenchmark']['scores'] = {};
      for (const skill of SKILL_KEYS) {
        scores[skill] = { you: you[skill], peerAvg: peerAvg[skill] ?? 50 };
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
          cohortSize,
          scores,
        },
        milestones: buildMilestones(user, interviewStats),
        lastComputedAt: FieldValue.serverTimestamp() as never,
      };

      await careerProgressRef(db, peer.uid).set(omitUndefinedDeep(progress), { merge: true });
      await db.collection('users').doc(peer.uid).set(
        {
          peerComparisonPercent: comparison,
          peerRole: roleKey(role) === 'general' ? 'peers' : `${role} peers`,
          readinessScore: readiness,
          'readiness.score': readiness,
          'stats.successfulInterviews': interviewStats.successful,
        },
        { merge: true },
      );
    }
  }
}
