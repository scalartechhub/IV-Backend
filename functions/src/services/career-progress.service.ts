/**
 * Career progress: peer benchmarks, salary insights, milestones.
 * Written to users/{uid}/careerProgress/current by the nightly job and
 * refreshed after each completed interview.
 */

import { FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import type { CareerProgressDoc } from '../interfaces/career-progress.interface';
import type { UserDoc } from '../interfaces/user.interface';
import { careerProgressRef, userRef } from '../utils/firestore-refs';
import { daysAgo } from '../utils/date-helpers';
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

const RESULT_FIELD: Record<SkillKey, string> = {
  technical: 'technicalScore',
  communication: 'communicationScore',
  confidence: 'confidenceScore',
  problemSolving: 'problemSolvingScore',
  coding: 'codingScore',
  behavior: 'behaviorScore',
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

function improvingLabel(delta: number): string | undefined {
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

function youScoresFromUser(user: CareerUser): Record<SkillKey, number> {
  const signals = user.skillSignals as Partial<Record<SkillKey, number>> | undefined;
  const you = {} as Record<SkillKey, number>;
  for (const key of SKILL_KEYS) {
    you[key] = clamp(typeof signals?.[key] === 'number' ? signals[key]! : 0);
  }
  return you;
}

function peerComparisonPercent(
  you: Record<SkillKey, number>,
  peerAvg: Record<string, number>,
): number {
  const deltas = SKILL_KEYS.map((key) => {
    const y = you[key] ?? 0;
    const avg = peerAvg[key] ?? 50;
    return Math.min(95, Math.max(5, 50 + (y - avg) * 1.25));
  });
  return clamp(deltas.reduce((sum, n) => sum + n, 0) / deltas.length);
}

function buildMilestones(user: CareerUser, you: Record<SkillKey, number>): CareerProgressDoc['milestones'] {
  const interviews =
    user.stats?.totalInterviews ??
    user.totalInterviews ??
    0;
  const successful = user.stats?.successfulInterviews ?? 0;

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
      currentValue: Math.min(80, you.technical),
      unlocksLevel: 'Senior Developer',
    },
    {
      id: 'coding_75',
      title: 'Reach 75+ coding score',
      targetValue: 75,
      currentValue: Math.min(75, you.coding),
      unlocksLevel: 'Senior Developer',
    },
    {
      id: 'successful_3',
      title: 'Score 70+ on 3 interviews',
      targetValue: 3,
      currentValue: Math.min(3, successful),
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
  const mid = (band.minLpa + band.maxLpa) / 2;
  const positionInRange =
    (mid - band.marketMin) / Math.max(1, band.marketMax - band.marketMin);

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

  const deltaWeek =
    user.readiness?.deltaWeek ??
    user.readinessDeltaThisWeek ??
    0;

  return {
    currency: 'INR',
    expectedRangeMin: lpaToInr(band.minLpa),
    expectedRangeMax: lpaToInr(band.maxLpa),
    positionInRange: Math.min(1, Math.max(0, positionInRange)),
    mostRequestedSkill: mostRequested,
    fastestImprovingSkill: {
      name: ranked[0] ?? 'communication',
      deltaPercent: Math.max(0, Math.round(deltaWeek)),
    },
  };
}

async function loadPeerAveragesForRole(
  db: Firestore,
  role: string,
): Promise<{ peerAvg: Record<string, number>; sampleSize: number }> {
  const since = daysAgo(30);
  const peerAvg: Record<string, number> = {};
  const skillSums: Record<string, number> = {};
  const skillCounts: Record<string, number> = {};

  const interviewsSnap = await db
    .collection('interviews')
    .where('status', '==', 'completed')
    .where('completedAt', '>=', since)
    .limit(500)
    .get();

  let sampleSize = 0;
  for (const doc of interviewsSnap.docs) {
    const data = doc.data();
    const targetRole =
      (data.config?.targetRole as string | undefined) ||
      (data.config?.topic as string | undefined) ||
      '';
    // Soft match: include interviews for same role cohort or when role is General
    if (
      role !== 'General' &&
      targetRole &&
      !targetRole.toLowerCase().includes(role.toLowerCase().slice(0, 12)) &&
      !role.toLowerCase().includes(targetRole.toLowerCase().slice(0, 12))
    ) {
      continue;
    }
    const results = data.results as Record<string, number> | undefined;
    if (!results) continue;
    sampleSize += 1;
    for (const key of SKILL_KEYS) {
      const val = results[RESULT_FIELD[key]];
      if (typeof val !== 'number') continue;
      skillSums[key] = (skillSums[key] ?? 0) + val;
      skillCounts[key] = (skillCounts[key] ?? 0) + 1;
    }
  }

  for (const key of SKILL_KEYS) {
    const count = skillCounts[key] ?? 0;
    peerAvg[key] =
      count > 0 ? Math.round((skillSums[key] ?? 0) / count) : 50;
  }

  return { peerAvg, sampleSize };
}

/**
 * Recompute and write career progress for one user.
 * Safe to call after interview complete (uses skillSignals + recent peers).
 */
export async function refreshCareerProgressForUser(uid: string): Promise<CareerProgressDoc | null> {
  const db = ensureAdmin();
  const snap = await userRef(db, uid).get();
  if (!snap.exists) return null;

  const user = { uid, ...snap.data() } as CareerUser;
  const role = resolveRole(user);
  const companies = resolveCompanies(user);
  const you = youScoresFromUser(user);
  const readiness = clamp(
    user.skillSignals?.totalScore ??
    user.readiness?.score ??
    user.readinessScore ??
    0,
  );

  // Prefer existing peer averages (from nightly job) to avoid heavy queries on every complete.
  const existing = await careerProgressRef(db, uid).get();
  let peerAvg: Record<string, number> = {};
  let cohortSize = 1;

  if (existing.exists) {
    const prev = existing.data() as CareerProgressDoc;
    for (const key of SKILL_KEYS) {
      peerAvg[key] = prev.peerBenchmark?.scores?.[key]?.peerAvg ?? 50;
    }
    cohortSize = Math.max(1, prev.peerBenchmark?.cohortSize ?? 1);
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
    improvingLabel: improvingLabel(deltaWeek),
    salaryInsights: buildSalaryInsights(user, readiness, you),
    peerBenchmark: {
      cohortLabel,
      cohortSize,
      scores,
    },
    milestones: buildMilestones(user, you),
    lastComputedAt: FieldValue.serverTimestamp() as never,
  };

  await careerProgressRef(db, uid).set(omitUndefinedDeep(progress), { merge: true });

  // Dual-write flat peer fields used by the dashboard home badge.
  await db.collection('users').doc(uid).set(
    {
      peerComparisonPercent: comparison,
      peerRole: role === 'General' ? 'peers' : `${role} peers`,
      readinessScore: readiness,
    },
    { merge: true },
  );

  return progress;
}

/**
 * Fetch existing career progress doc for user. If it doesn't exist, compute & write it first.
 */
export async function getCareerProgress(uid: string): Promise<CareerProgressDoc> {
  const db = ensureAdmin();
  const snap = await careerProgressRef(db, uid).get();

  if (snap.exists) {
    return snap.data() as CareerProgressDoc;
  }

  const computed = await refreshCareerProgressForUser(uid);
  if (!computed) {
    throw new AppError(404, 'User profile not found.');
  }

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
    const { peerAvg, sampleSize } = await loadPeerAveragesForRole(db, role);

    for (const uid of uids) {
      const userSnap = await userRef(db, uid).get();
      if (!userSnap.exists) continue;
      const user = { uid, ...userSnap.data() } as CareerUser;
      const you = youScoresFromUser(user);
      const readiness = clamp(
        user.skillSignals?.totalScore ?? user.readiness?.score ?? 0,
      );
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
        improvingLabel: improvingLabel(deltaWeek),
        salaryInsights: buildSalaryInsights(user, readiness, you),
        peerBenchmark: {
          cohortLabel:
            companies.length > 0
              ? `${role} targeting ${companies.join(', ')}`
              : `${role} cohort`,
          cohortSize: Math.max(uids.length, sampleSize, 1),
          scores,
        },
        milestones: buildMilestones(user, you),
        lastComputedAt: FieldValue.serverTimestamp() as never,
      };

      await careerProgressRef(db, uid).set(omitUndefinedDeep(progress), { merge: true });
      await db.collection('users').doc(uid).set(
        {
          peerComparisonPercent: comparison,
          peerRole: role === 'General' ? 'peers' : `${role} peers`,
          readinessScore: readiness,
        },
        { merge: true },
      );
    }
  }
}
