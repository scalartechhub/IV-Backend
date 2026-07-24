/**
 * V2 interview service — start / complete / get / list (architecture InterviewDoc shape).
 */

import { FieldValue } from 'firebase-admin/firestore';
import type {
  EndReason,
  InterviewConfig,
  InterviewMode,
  InterviewStatus,
} from '../interfaces/interview.interface';
import type { GoalDoc } from '../interfaces/user.interface';
import { buildGeminiSessionConfig } from '../lib/gemini-client';
import { applyLevelUpdate, resolveLevel } from '../lib/level';
import { writeReadiness } from '../lib/readiness';
import { scoreInterview } from '../lib/scoring';
import { updateSkills, type SkillScoreMap } from '../lib/skills';
import { updateStreak } from '../lib/streak';
import {
  calculateInterviewXp,
  creditXpInTransaction,
  normalizeXpAmount,
} from '../lib/xp';
import { AppError } from '../shared/utils';
import { ensureAdmin } from '../utils/callable-auth';
import { dayAbbrev, formatDate, getWeekStart } from '../utils/date-helpers';
import {
  goalsCol,
  interviewRef,
  resumeRef,
  resumesCol,
  userRef,
  weeklyStatsRef,
} from '../utils/firestore-refs';
import { checkAchievements } from './achievement.service';
import { generateReport } from './report.service';
import { ensureUserDefaults } from './schema-defaults';

export interface StartInterviewInput extends InterviewConfig {
  mode?: InterviewMode;
}

export interface StartInterviewResult {
  interviewId: string;
  geminiSessionConfig: ReturnType<typeof buildGeminiSessionConfig>;
}

export interface CompleteInterviewInput {
  interviewId: string;
  transcriptSummary: string;
  durationSec: number;
  endReason: EndReason;
}

export interface CompleteInterviewResult {
  xpEarned: number;
  newLevel: number;
  levelUp: boolean;
  updatedSkills: SkillScoreMap;
  streakCount: number;
  readinessScore: number;
}

const MODE_GOAL_MATCH: Record<string, string[]> = {
  conversational: ['mock_interview', 'conversational', 'interview'],
  coding: ['coding', 'coding_interview'],
  behavioral: ['behavioral'],
  system_design: ['system_design'],
};

/**
 * Create interviews/{id} with status created + Gemini Live session config.
 */
export async function startInterview(
  uid: string,
  input: StartInterviewInput,
): Promise<StartInterviewResult> {
  const db = ensureAdmin();
  await ensureUserDefaults(db, uid);

  const mode: InterviewMode = input.mode ?? 'conversational';
  const config: InterviewConfig = {
    topic: input.topic,
    company: input.company,
    skills: input.skills,
    technologies: input.technologies,
    difficulty: input.difficulty,
    durationMinutes: input.durationMinutes,
    resumeVersionUsed: input.resumeVersionUsed,
    currentRole: input.currentRole,
    targetRole: input.targetRole,
    sourceRoadmapActivityId: input.sourceRoadmapActivityId,
  };

  if (config.resumeVersionUsed) {
    const resumeSnap = await resumeRef(db, uid, config.resumeVersionUsed).get();
    if (!resumeSnap.exists) {
      throw new AppError(404, 'Referenced resume does not exist.');
    }
  } else {
    const active = await resumesCol(db, uid)
      .where('isActive', '==', true)
      .limit(1)
      .get();
    if (!active.empty) {
      config.resumeVersionUsed = active.docs[0].id;
    }
  }

  const recent = await db
    .collection('interviews')
    .where('userId', '==', uid)
    .where('status', '==', 'completed')
    .orderBy('completedAt', 'desc')
    .limit(3)
    .get();

  const previousWeaknesses: string[] = [];
  for (const doc of recent.docs) {
    const results = doc.data().results as { weaknesses?: string[] } | undefined;
    if (results?.weaknesses?.length) {
      previousWeaknesses.push(...results.weaknesses.slice(0, 3));
    }
  }

  let resumeContext = '';
  if (config.resumeVersionUsed) {
    const resume = (await resumeRef(db, uid, config.resumeVersionUsed).get()).data();
    if (resume?.analysis) {
      resumeContext = [
        `Keywords: ${(resume.analysis.extractedKeywords ?? []).join(', ')}`,
        `Recommended skills: ${(resume.analysis.recommendedSkills ?? []).join(', ')}`,
        `Missing keywords: ${(resume.analysis.missingKeywords ?? []).join(', ')}`,
      ].join('\n');
    }
  }

  const systemInstructions = [
    `You are an expert interviewer conducting a ${mode} interview.`,
    `Candidate current role: ${config.currentRole}.`,
    `Target role: ${config.targetRole}.`,
    `Difficulty: ${config.difficulty}. Duration: ${config.durationMinutes} minutes.`,
    `Focus skills: ${config.skills.join(', ') || 'general'}.`,
    `Technologies: ${config.technologies.join(', ') || 'general'}.`,
    config.topic ? `Topic: ${config.topic}.` : '',
    config.company ? `Company style: ${config.company}.` : '',
    resumeContext ? `Resume signals:\n${resumeContext}` : '',
    previousWeaknesses.length
      ? `Bias follow-ups toward prior weaknesses: ${previousWeaknesses.slice(0, 9).join('; ')}`
      : '',
    'Keep questions concise. Probe depth. Be encouraging but rigorous.',
  ]
    .filter(Boolean)
    .join('\n');

  const interviewDocRef = interviewRef(db, db.collection('interviews').doc().id);
  const now = FieldValue.serverTimestamp();

  await interviewDocRef.set({
    userId: uid,
    mode,
    status: 'created',
    config,
    autoEnded: false,
    transcriptArchived: false,
    aiSession: {
      geminiSessionId: '',
      modelVersion: process.env.GEMINI_LIVE_MODEL ?? 'gemini-live-2.5',
      tokenUsage: { input: 0, output: 0, total: 0 },
      estimatedCostUsd: 0,
      connectionQuality: 'good',
      reconnectCount: 0,
    },
    environment: {
      audioEnabled: false,
      cameraEnabled: false,
      browser: '',
      os: '',
      internetQualityMbps: 0,
    },
    xpEarned: 0,
    createdAt: now,
    updatedAt: now,
  } as never);

  return {
    interviewId: interviewDocRef.id,
    geminiSessionConfig: buildGeminiSessionConfig(systemInstructions),
  };
}

/**
 * Score + XP/skills/streak pipeline. Gemini scoring runs before the transaction.
 */
export async function completeInterview(
  uid: string,
  input: CompleteInterviewInput,
): Promise<CompleteInterviewResult> {
  const db = ensureAdmin();
  await ensureUserDefaults(db, uid);

  const { interviewId, transcriptSummary, durationSec, endReason } = input;

  const interviewSnap = await interviewRef(db, interviewId).get();
  if (!interviewSnap.exists) {
    throw new AppError(404, 'Interview not found.');
  }
  const interview = interviewSnap.data()!;
  if (interview.userId !== uid) {
    throw new AppError(403, 'Interview does not belong to the authenticated user.');
  }
  if (interview.status === 'completed') {
    throw new AppError(412, 'Interview is already completed.');
  }

  const results = await scoreInterview({
    transcriptSummary,
    config: interview.config,
    mode: interview.mode,
  });

  const xpEarned = calculateInterviewXp({
    overallScore: results.overallScore,
    durationSec,
    durationMinutes: interview.config.durationMinutes,
    difficulty: interview.config.difficulty,
  });

  const now = new Date();
  const today = formatDate(now);
  const weekStart = getWeekStart(now);
  const todayAbbrev = dayAbbrev(now);

  const txResult = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef(db, uid));
    if (!userSnap.exists) {
      throw new AppError(404, 'User document not found.');
    }
    const user = userSnap.data()!;
    const prevXP = user.gamification?.currentXP ?? 0;
    const prevLevel = user.gamification?.level ?? 1;

    creditXpInTransaction(tx, db, uid, {
      amount: xpEarned,
      reason: 'interview_completed',
      relatedId: interviewId,
    });

    let runningXP = prevXP + xpEarned;
    const levelInfo = applyLevelUpdate(tx, db, uid, prevLevel, runningXP);
    const updatedSkills = await updateSkills(tx, db, uid, results.skillDeltas);

    const score7dAgo =
      user.readiness?.readinessScore7dAgo ?? user.readiness?.score;
    const { readinessScore } = writeReadiness(
      tx,
      db,
      uid,
      updatedSkills,
      score7dAgo,
    );

    const streak = updateStreak(tx, db, uid, user.gamification, now);

    const statsRef = weeklyStatsRef(db, uid, weekStart);
    const statsSnap = await tx.get(statsRef);
    const minutes = Math.round(durationSec / 60);
    if (statsSnap.exists) {
      tx.update(statsRef, {
        technical: updatedSkills.technical,
        communication: updatedSkills.communication,
        confidence: updatedSkills.confidence,
        problemSolving: updatedSkills.problemSolving,
        coding: updatedSkills.coding,
        behavior: updatedSkills.behavior,
        interviewsCompleted: FieldValue.increment(1),
        practiceMinutes: FieldValue.increment(minutes),
        [`practiceMinutesByDay.${todayAbbrev}`]: FieldValue.increment(minutes),
      });
    } else {
      tx.set(statsRef, {
        weekStart,
        technical: updatedSkills.technical,
        communication: updatedSkills.communication,
        confidence: updatedSkills.confidence,
        problemSolving: updatedSkills.problemSolving,
        coding: updatedSkills.coding,
        behavior: updatedSkills.behavior,
        hiringProbability: readinessScore,
        interviewsCompleted: 1,
        practiceMinutes: minutes,
        practiceMinutesByDay: { [todayAbbrev]: minutes },
      });
    }

    const goalsSnap = await tx.get(
      goalsCol(db, uid).where('date', '==', today).where('status', '==', 'pending'),
    );
    const matchKeys = MODE_GOAL_MATCH[interview.mode] ?? [interview.mode];
    for (const goalDoc of goalsSnap.docs) {
      const goal = goalDoc.data() as GoalDoc;
      const implied = (goal.impliedType ?? '').toLowerCase();
      if (
        !implied ||
        matchKeys.some((k) => implied.includes(k) || k.includes(implied))
      ) {
        tx.update(goalDoc.ref, { status: 'done' });
        const reward = normalizeXpAmount(goal.xpReward ?? 0);
        if (reward > 0) {
          creditXpInTransaction(tx, db, uid, {
            amount: reward,
            reason: 'goal_completed',
            relatedId: goalDoc.id,
          });
          runningXP += reward;
          applyLevelUpdate(tx, db, uid, levelInfo.level, runningXP);
        }
      }
    }

    tx.update(interviewRef(db, interviewId), {
      results,
      xpEarned,
      status: 'completed',
      durationSec,
      endReason,
      autoEnded: endReason === 'time_expired',
      transcriptArchived: interview.transcriptArchived ?? false,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.update(userRef(db, uid), {
      'stats.totalInterviews': FieldValue.increment(1),
    });

    return {
      xpEarned,
      newLevel: resolveLevel(runningXP).level,
      levelUp: levelInfo.levelUp || resolveLevel(runningXP).level > prevLevel,
      updatedSkills,
      streakCount: streak.streakCount,
      readinessScore,
    };
  });

  await checkAchievements(uid, { overallScore: results.overallScore }).catch(
    (err: unknown) => {
      console.error('[completeInterview] checkAchievements failed', err);
    },
  );
  await generateReport(uid, interviewId, results).catch((err: unknown) => {
    console.error('[completeInterview] generateReport failed', err);
  });

  return txResult;
}

export async function getInterview(uid: string, interviewId: string) {
  const db = ensureAdmin();
  const snap = await interviewRef(db, interviewId).get();
  if (!snap.exists) throw new AppError(404, 'Interview not found.');
  const data = snap.data()!;
  if (data.userId !== uid) {
    throw new AppError(403, 'Interview does not belong to the authenticated user.');
  }
  return { id: snap.id, ...data };
}

export async function listInterviews(
  uid: string,
  opts: { status?: InterviewStatus; mode?: InterviewMode; limit?: number } = {},
) {
  const db = ensureAdmin();
  const limit = Math.min(opts.limit ?? 20, 50);
  let query = db
    .collection('interviews')
    .where('userId', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(limit);

  if (opts.status) {
    query = db
      .collection('interviews')
      .where('userId', '==', uid)
      .where('status', '==', opts.status)
      .orderBy('completedAt', 'desc')
      .limit(limit);
  } else if (opts.mode) {
    query = db
      .collection('interviews')
      .where('userId', '==', uid)
      .where('mode', '==', opts.mode)
      .orderBy('completedAt', 'desc')
      .limit(limit);
  }

  const snap = await query.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
