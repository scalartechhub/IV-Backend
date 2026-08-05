/**
 * V2 interview service — start / complete / get / list / status / environment.
 * Supports Practice UI: templateId, companyId, quickStart.
 */

import { FieldValue } from 'firebase-admin/firestore';
import type {
  EndReason,
  InterviewConfig,
  InterviewDifficulty,
  InterviewDoc,
  InterviewEnvironment,
  InterviewMode,
  InterviewStatus,
} from '../interfaces/interview.interface';
import type { GoalDoc } from '../interfaces/user.interface';
import { buildGeminiSessionConfig } from '../library/gemini-client';
import { applyLevelUpdate, resolveLevel } from '../library/level';
import { writeReadiness } from '../library/readiness';
import { scoreInterview } from '../library/scoring';
import { updateUserSkillSignals } from '../library/skill-signals';
import { refreshCareerProgressForUser } from './career-progress.service';
import { loadTopicProfile, updateTopicProfile } from '../library/topic-profile';
import {
  DEFAULT_SKILL_SCORE,
  SKILL_IDS,
  writeSkillUpdates,
  type SkillScoreMap,
} from '../library/skills';
import { updateStreak } from '../library/streak';
import {
  calculateInterviewXp,
  creditXpInTransaction,
  normalizeXpAmount,
} from '../library/xp';
import { AppError } from '../shared/utils';
import { ensureAdmin } from '../utils/callable-auth';
import { dayAbbrev, formatDate, getWeekStart } from '../utils/date-helpers';
import {
  goalsCol,
  interviewRef,
  onboardingAnalysisRef,
  skillRef,
  userRef,
  weeklyStatsRef,
} from '../utils/firestore-refs';
import {
  computeLiveElapsedSec,
  computeRemainingSeconds,
  formatConversationTranscript,
} from '../modules/v2/v2-live-interview.persistence';
import { checkAchievements } from './achievement.service';
import {
  evaluateDayInterview,
  parseLearningRoadmapActivityId,
} from './learning-roadmap.service';
import { getCompany, getPracticeTemplate } from './practice.service';
import { generateReport } from './report.service';
import { ensureUserDefaults } from './schema-defaults';
import {
  buildInterviewSystemInstructions,
  buildResumeContextFromAnalysis,
} from './interview-prompt';

export interface StartInterviewInput {
  mode?: InterviewMode;
  topic?: string;
  company?: string;
  skills?: string[];
  technologies?: string[];
  difficulty?: InterviewDifficulty;
  durationMinutes?: number;
  resumeVersionUsed?: string;
  currentRole?: string;
  targetRole?: string;
  sourceRoadmapActivityId?: string;
  /** Practice page — start from recommended session */
  templateId?: string;
  /** Practice page — start from company prep card */
  companyId?: string;
  /** Practice page — Quick start with profile defaults */
  quickStart?: boolean;
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
  conversational: ['mock_interview', 'conversational', 'interview', 'technical'],
  coding: ['coding', 'coding_interview'],
  behavioral: ['behavioral'],
  system_design: ['system_design'],
  hr: ['hr', 'screening', 'soft_skills'],
};

const STATUS_FLOW: InterviewStatus[] = [
  'created',
  'device_check',
  'in_progress',
  'completed',
  'abandoned',
  'expired',
];

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

async function resolveStartConfig(
  uid: string,
  input: StartInterviewInput,
): Promise<{ mode: InterviewMode; config: InterviewConfig }> {
  const db = ensureAdmin();
  const userSnap = await userRef(db, uid).get();
  const profile = userSnap.data()?.profile;
  const profileCurrent = profile?.currentRole || 'Software Developer';
  const profileTarget = profile?.targetRole || profileCurrent;

  // 1) Template from Practice recommended sessions
  if (input.templateId) {
    const template = await getPracticeTemplate(input.templateId);
    const defaults = template.configDefaults;
    return {
      mode: input.mode ?? template.mode,
      config: {
        topic: input.topic ?? defaults.topic,
        company: input.company ?? defaults.company,
        skills: input.skills ?? defaults.skills,
        technologies: input.technologies ?? defaults.technologies,
        difficulty: input.difficulty ?? defaults.difficulty,
        durationMinutes: input.durationMinutes ?? defaults.durationMinutes,
        resumeVersionUsed: input.resumeVersionUsed,
        currentRole: input.currentRole ?? profileCurrent,
        targetRole: input.targetRole ?? profileTarget,
        sourceRoadmapActivityId: input.sourceRoadmapActivityId,
        sourceTemplateId: template.id,
      },
    };
  }

  // 2) Company prep card
  if (input.companyId) {
    const company = await getCompany(input.companyId);
    const difficultyMap: Record<string, InterviewDifficulty> = {
      Easy: 'easy',
      Medium: 'medium',
      Hard: 'hard',
    };
    return {
      mode: input.mode ?? 'conversational',
      config: {
        topic: input.topic ?? `${company.name} interview prep`,
        company: company.name,
        skills: input.skills ?? [company.name.toLowerCase(), 'interview-prep'],
        technologies: input.technologies ?? [],
        difficulty:
          input.difficulty ?? difficultyMap[company.difficulty] ?? 'medium',
        durationMinutes: input.durationMinutes ?? 30,
        resumeVersionUsed: input.resumeVersionUsed,
        currentRole: input.currentRole ?? profileCurrent,
        targetRole: input.targetRole ?? profileTarget,
        sourceRoadmapActivityId: input.sourceRoadmapActivityId,
        sourceCompanyId: company.id,
      },
    };
  }

  // 3) Quick start — profile-driven defaults
  if (input.quickStart) {
    return {
      mode: input.mode ?? 'conversational',
      config: {
        topic: input.topic ?? `${profileTarget} practice interview`,
        company: input.company ?? profile?.targetCompanies?.[0],
        skills: input.skills ?? [profileTarget],
        technologies: input.technologies ?? [],
        difficulty: input.difficulty ?? 'medium',
        durationMinutes: input.durationMinutes ?? 30,
        resumeVersionUsed: input.resumeVersionUsed,
        currentRole: input.currentRole ?? profileCurrent,
        targetRole: input.targetRole ?? profileTarget,
        sourceRoadmapActivityId: input.sourceRoadmapActivityId,
      },
    };
  }

  // 4) Explicit config from Setup (type, technology, difficulty, duration)
  if (input.difficulty !== undefined && input.durationMinutes !== undefined) {
    const technologies = input.technologies ?? input.skills ?? [];
    const skills = input.skills ?? input.technologies ?? [];
    return {
      mode: input.mode ?? 'conversational',
      config: {
        topic:
          input.topic ??
          `${technologies[0] ?? skills[0] ?? profileTarget} interview`,
        company: input.company,
        skills,
        technologies,
        difficulty: input.difficulty,
        durationMinutes: input.durationMinutes,
        resumeVersionUsed: input.resumeVersionUsed,
        currentRole: input.currentRole ?? profileCurrent,
        targetRole: input.targetRole ?? profileTarget,
        sourceRoadmapActivityId: input.sourceRoadmapActivityId,
      },
    };
  }

  throw new AppError(
    400,
    'Provide difficulty and durationMinutes (with mode/technology), or templateId / companyId / quickStart.',
  );
}

/**
 * Create interviews/{id} with status created + Gemini Live session config.
 */
export async function startInterview(
  uid: string,
  input: StartInterviewInput,
): Promise<StartInterviewResult> {
  const db = ensureAdmin();
  await ensureUserDefaults(db, uid);

  const resolved = await resolveStartConfig(uid, input);
  const mode = resolved.mode;
  const config = omitUndefinedDeep(resolved.config);

  // resumeVersionUsed is only set when Setup explicitly opts in ("Using resume").
  const useResume = Boolean(config.resumeVersionUsed);
  const resumeSnap = useResume ? await onboardingAnalysisRef(db, uid).get() : null;
  if (useResume && !resumeSnap?.exists) {
    throw new AppError(404, 'No resume analysis found for this account.');
  }
  if (!useResume) {
    delete config.resumeVersionUsed;
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
  if (useResume && resumeSnap?.exists) {
    const resume = resumeSnap.data();
    if (resume) {
      resumeContext = buildResumeContextFromAnalysis(resume);
    }
  }

  const topicProfile = await loadTopicProfile(db, uid);

  const systemInstructions = buildInterviewSystemInstructions(mode, config, {
    resumeContext: resumeContext || undefined,
    previousWeaknesses,
    topicProfile,
  });

  const interviewDocRef = interviewRef(db, db.collection('interviews').doc().id);
  const now = FieldValue.serverTimestamp();
  const geminiSessionConfig = buildGeminiSessionConfig(systemInstructions);

  await interviewDocRef.set({
    userId: uid,
    mode,
    status: 'created',
    config,
    autoEnded: false,
    transcriptArchived: false,
    isDeleted: false,
    aiSession: {
      geminiSessionId: '',
      modelVersion: geminiSessionConfig.modelVersion,
      tokenUsage: { input: 0, output: 0, total: 0 },
      estimatedCostUsd: 0,
      connectionQuality: 'good',
      reconnectCount: 0,
      systemInstructions,
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
    geminiSessionConfig,
  };
}

/**
 * Advance interview through UI flow: created → device_check → in_progress.
 * Terminal statuses (completed / abandoned / expired) are set by complete or abandon.
 */
export async function updateInterviewStatus(
  uid: string,
  interviewId: string,
  status: InterviewStatus,
): Promise<{ id: string; status: InterviewStatus }> {
  const db = ensureAdmin();
  const ref = interviewRef(db, interviewId);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError(404, 'Interview not found.');
  const interview = snap.data()!;
  if (interview.userId !== uid) {
    throw new AppError(403, 'Interview does not belong to the authenticated user.');
  }
  if (interview.status === 'completed') {
    throw new AppError(412, 'Completed interviews cannot change status.');
  }
  if (!STATUS_FLOW.includes(status)) {
    throw new AppError(400, `Invalid status: ${status}`);
  }
  if (status === 'completed') {
    throw new AppError(400, 'Use POST /:id/complete to finish an interview.');
  }

  const updates: Record<string, unknown> = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (status === 'in_progress' && !interview.startedAt) {
    updates.startedAt = FieldValue.serverTimestamp();
  }

  await ref.update(updates);
  return { id: interviewId, status };
}

/**
 * Persist device-check results from /interview/setup.
 */
export async function updateInterviewEnvironment(
  uid: string,
  interviewId: string,
  environment: Partial<InterviewEnvironment>,
): Promise<{ id: string }> {
  const db = ensureAdmin();
  const ref = interviewRef(db, interviewId);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError(404, 'Interview not found.');
  const interview = snap.data()!;
  if (interview.userId !== uid) {
    throw new AppError(403, 'Interview does not belong to the authenticated user.');
  }
  if (interview.status === 'completed') {
    throw new AppError(412, 'Completed interviews are immutable.');
  }

  const merged: InterviewEnvironment = {
    ...interview.environment,
    ...environment,
  };

  await ref.update({
    environment: merged,
    status:
      interview.status === 'created' ? 'device_check' : interview.status,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { id: interviewId };
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

  const resolvedTranscript =
    transcriptSummary.trim() ||
    formatConversationTranscript(interview.conversation) ||
    'No conversation was captured during this session.';

  const results = await scoreInterview({
    transcriptSummary: resolvedTranscript,
    config: interview.config,
    mode: interview.mode,
    durationSec,
    durationMinutes: interview.config.durationMinutes,
    endReason,
    conversation: interview.conversation,
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
    // --- Reads (Firestore transactions require ALL reads before ANY writes) ---
    const userSnap = await tx.get(userRef(db, uid));
    if (!userSnap.exists) {
      throw new AppError(404, 'User document not found.');
    }
    const user = userSnap.data()!;

    const skillSnaps = await Promise.all(
      SKILL_IDS.map((id) => tx.get(skillRef(db, uid, id))),
    );
    const currentSkills = {} as SkillScoreMap;
    for (let i = 0; i < SKILL_IDS.length; i++) {
      const id = SKILL_IDS[i];
      const snap = skillSnaps[i];
      currentSkills[id] =
        snap.exists && typeof snap.data()?.score === 'number'
          ? (snap.data()!.score as number)
          : DEFAULT_SKILL_SCORE;
    }

    const statsRef = weeklyStatsRef(db, uid, weekStart);
    const statsSnap = await tx.get(statsRef);

    const goalsSnap = await tx.get(
      goalsCol(db, uid).where('date', '==', today).where('status', '==', 'pending'),
    );

    // --- Writes ---
    // Legacy user docs (created pre-v2) may be missing the gamification block
    // even after ensureUserDefaults; fall back defensively so this never 500s.
    const gamification = user.gamification ?? {
      level: 1,
      levelName: 'Candidate',
      currentXP: 0,
      xpToNextLevel: 500,
      streakCount: 0,
      lastActiveDate: '',
      longestStreak: 0,
    };
    const prevXP = gamification.currentXP ?? 0;
    const prevLevel = gamification.level ?? 1;

    creditXpInTransaction(tx, db, uid, {
      amount: xpEarned,
      reason: 'interview_completed',
      relatedId: interviewId,
    });

    let runningXP = prevXP + xpEarned;
    const levelInfo = applyLevelUpdate(tx, db, uid, prevLevel, runningXP);
    const updatedSkills = writeSkillUpdates(tx, db, uid, currentSkills, results.skillDeltas);

    const score7dAgo =
      user.readiness?.readinessScore7dAgo ?? user.readiness?.score;
    const { readinessScore } = writeReadiness(
      tx,
      db,
      uid,
      updatedSkills,
      score7dAgo,
    );

    const streak = updateStreak(tx, db, uid, gamification, now);

    const minutes = Math.round(durationSec / 60);
    const prevLongestSec: number = statsSnap.exists
      ? ((statsSnap.data() as { longestSessionSec?: number }).longestSessionSec ?? 0)
      : 0;
    const isNewLongest = durationSec > prevLongestSec;

    if (statsSnap.exists) {
      tx.update(statsRef, {
        technical: updatedSkills.technical,
        communication: updatedSkills.communication,
        confidence: updatedSkills.confidence,
        problemSolving: updatedSkills.problemSolving,
        coding: updatedSkills.coding,
        behavior: updatedSkills.behavior,
        hiringProbability: readinessScore,
        interviewsCompleted: FieldValue.increment(1),
        practiceMinutes: FieldValue.increment(minutes),
        [`practiceMinutesByDay.${todayAbbrev}`]: FieldValue.increment(minutes),
        [`sessionsByDay.${today}`]: FieldValue.increment(1),
        ...(isNewLongest && {
          longestSessionSec: durationSec,
          longestSessionDay: todayAbbrev,
        }),
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
        sessionsByDay: { [today]: 1 },
        longestSessionSec: durationSec,
        longestSessionDay: todayAbbrev,
      });
    }

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
      isDeleted: interview.isDeleted ?? false,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.update(userRef(db, uid), {
      'stats.totalInterviews': FieldValue.increment(1),
      ...(results.overallScore >= 70
        ? { 'stats.successfulInterviews': FieldValue.increment(1) }
        : {}),
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

  await checkAchievements(uid, {
    completed: true,
    overallScore: results.overallScore,
    xpEarned: txResult.xpEarned,
    success: results.overallScore >= 70,
    deliveryScore: results.communicationScore,
    contentScore: results.technicalScore,
    skillScores: {
      technical: results.technicalScore,
      communication: results.communicationScore,
      confidence: results.confidenceScore,
      problemSolving: results.problemSolvingScore,
      behavior: results.behaviorScore ?? 0,
    },
    tracks: [
      interview.mode,
      ...(interview.config.technologies ?? []),
      ...(interview.config.skills ?? []),
      interview.config.topic,
      interview.config.company,
    ].filter((value): value is string => Boolean(value?.trim())),
  }).catch((err: unknown) => {
    console.error('[completeInterview] checkAchievements failed', err);
  });
  await generateReport(uid, interviewId, results).catch((err: unknown) => {
    console.error('[completeInterview] generateReport failed', err);
  });
  await updateTopicProfile(db, uid, results.topicOutcomes ?? []).catch(
    (err: unknown) => {
      console.error('[completeInterview] updateTopicProfile failed', err);
    },
  );
  await updateUserSkillSignals(db, uid).catch((err: unknown) => {
    console.error('[completeInterview] updateUserSkillSignals failed', err);
  });
  await refreshCareerProgressForUser(uid).catch((err: unknown) => {
    console.error('[completeInterview] refreshCareerProgressForUser failed', err);
  });

  const roadmapActivity = parseLearningRoadmapActivityId(
    interview.config.sourceRoadmapActivityId,
  );
  if (roadmapActivity) {
    await evaluateDayInterview(
      uid,
      roadmapActivity.week,
      roadmapActivity.day,
      results.overallScore,
      interviewId,
    ).catch((err: unknown) => {
      console.error('[completeInterview] evaluateDayInterview failed', err);
    });
  }

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
  return {
    id: snap.id,
    ...data,
    remainingSeconds: computeRemainingSeconds(data as InterviewDoc),
    liveElapsedSec: computeLiveElapsedSec(data as InterviewDoc),
  };
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
