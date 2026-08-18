/**
 * Recent-interview skill signals: average of each skill across the candidate's
 * last N completed interviews, plus a single totalScore average of all skills.
 * Recomputed after every interview completes + report generates.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { InterviewResults } from '../interfaces/interview.interface';
import type { SkillId } from '../interfaces/user.interface';
import { SKILL_IDS, type SkillScoreMap } from './skills';
import { reportsCol, userRef } from '../utils/firestore-refs';

export const RECENT_INTERVIEWS_FOR_SKILL_SIGNALS = 5;

/** Maps each skill id to the InterviewResults field that scores it. */
const RESULT_FIELD_BY_SKILL: Record<SkillId, keyof InterviewResults> = {
  technical: 'technicalScore',
  communication: 'communicationScore',
  confidence: 'confidenceScore',
  problemSolving: 'problemSolvingScore',
  coding: 'codingScore',
  behavior: 'behaviorScore',
};

function average(values: number[]): number {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

export type SkillSignals = SkillScoreMap & { totalScore: number };

/**
 * Pure: average each skill across the given interview results (caller is
 * responsible for passing only the most recent N, e.g. via a limited query).
 * Skills with no recorded value across the sample (e.g. codingScore on a
 * behavioral interview) default to 0. `totalScore` (average of all 6 skills)
 * is included in the same object.
 */
export function computeSkillSignals(
  recentResults: InterviewResults[],
): SkillSignals {
  const skillSignals = {} as SkillSignals;
  for (const id of SKILL_IDS) {
    const field = RESULT_FIELD_BY_SKILL[id];
    const values = recentResults
      .map((r) => r[field])
      .filter((v): v is number => typeof v === 'number');
    skillSignals[id] = average(values);
  }
  skillSignals.totalScore = average(SKILL_IDS.map((id) => skillSignals[id]));
  return skillSignals;
}

/**
 * Recompute skillSignals (incl. totalScore) from the user's last 5 completed
 * interviews and persist onto users/{uid}. Best-effort — callers should
 * wrap in `.catch()` (same pattern as generateReport / checkAchievements).
 */
export async function updateUserSkillSignals(
  db: Firestore,
  uid: string,
): Promise<void> {
  const reportSnap = await reportsCol(db, uid)
    .orderBy('generatedAt', 'desc')
    .limit(RECENT_INTERVIEWS_FOR_SKILL_SIGNALS)
    .get();

  const fromReports = reportSnap.docs.map((d) => {
    const data = d.data() as {
      charts?: {
        skillBreakdown?: Partial<Record<SkillId, number>>;
        timeline?: Array<{ score?: number }>;
      };
    };
    const breakdown = data.charts?.skillBreakdown ?? {};
    const overall = data.charts?.timeline?.[0]?.score;
    return {
      overallScore: typeof overall === 'number' ? overall : 0,
      technicalScore: breakdown.technical ?? 0,
      communicationScore: breakdown.communication ?? 0,
      confidenceScore: breakdown.confidence ?? 0,
      problemSolvingScore: breakdown.problemSolving ?? 0,
      ...(typeof breakdown.coding === 'number' ? { codingScore: breakdown.coding } : {}),
      ...(typeof breakdown.behavior === 'number' ? { behaviorScore: breakdown.behavior } : {}),
      skillDeltas: {},
      strengths: [],
      weaknesses: [],
      recommendations: [],
    } as InterviewResults;
  });

  const recentResults = fromReports.length > 0
    ? fromReports
    : (
        await db
          .collection('interviews')
          .where('userId', '==', uid)
          .where('status', '==', 'completed')
          .orderBy('completedAt', 'desc')
          .limit(RECENT_INTERVIEWS_FOR_SKILL_SIGNALS)
          .get()
      ).docs
        .map((d) => d.data().results as InterviewResults | undefined)
        .filter((r): r is InterviewResults => Boolean(r));

  const skillSignals = computeSkillSignals(recentResults);

  await userRef(db, uid).set({ skillSignals }, { merge: true });
}
