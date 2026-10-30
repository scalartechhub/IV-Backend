/**
 * V2 interview service — start / complete / get / list / status / environment.
 * Supports Practice UI: templateId, companyId, quickStart.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import type {
  EndReason,
  InterviewConfig,
  InterviewDifficulty,
  InterviewDoc,
  InterviewEnvironment,
  InterviewFocusAreas,
  InterviewMode,
  InterviewResults,
  InterviewStatus,
} from '../interfaces/interview.interface';
import type { GoalDoc } from '../interfaces/user.interface';
import { buildGeminiSessionConfig } from '../library/gemini-client';
import { applyLevelUpdate, resolveLevel } from '../library/level';
import { writeReadiness } from '../library/readiness';
import {
  countCandidateAnswers,
  countCandidateAnswersFromTranscript,
  scoreInterview,
} from '../library/scoring';
import { updateUserSkillSignals } from '../library/skill-signals';
import { refreshCareerProgressForUser } from './career-progress.service';
import { loadTopicProfile, updateTopicProfile } from '../library/topic-profile';
import {
  DEFAULT_SKILL_SCORE,
  SKILL_IDS,
  writeSkillUpdates,
  type SkillScoreMap,
} from '../library/skills';
import { calculateInterviewXp, creditXpInTransaction } from '../library/xp';
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
  evaluateWeekInterview,
  parseLearningRoadmapActivityId,
} from './learning-roadmap.service';
import { getCompany, getPracticeTemplate } from './practice.service';
import { generateReport } from './report.service';
import { ensureUserDefaults } from './schema-defaults';
import {
  buildInterviewSystemInstructions,
  buildResumeContextFromAnalysis,
  OPENING_ANGLES,
} from '../prompts/interview/interview-system.prompt';

const PREVIOUS_INTERVIEWS_SCANNED = 15;
const PREVIOUS_QUESTIONS_LIMIT = 30;
const PREVIOUS_QUESTION_CHARS = 220;

const normalizeSubject = (value?: string): string => (value ?? '').trim().toLowerCase();

/**
 * Same interview: a posted job stays its own interview (jdId).
 * Every other start path is linked by target role, so Quick start, a recommendation,
 * a company card, and a custom topic for "Full Stack Developer" share one question history.
 * Topic / technology / skill are only a fallback for older interviews that stored no role.
 */
const subjectKey = (mode: InterviewMode, config: Partial<InterviewConfig>): string => {
  const jd = config.jdId?.trim();
  if (jd) return `jd:${jd}`;
  const subject =
    normalizeSubject(config.targetRole) ||
    normalizeSubject(config.topic) ||
    normalizeSubject(config.technologies?.[0]) ||
    normalizeSubject(config.skills?.[0]);
  return `${mode}:${subject}`;
};

/** Pulls the question sentence out of an interviewer turn ("Good point. How would you …?" → "How would you …?"). */
const extractQuestion = (text: string): string => {
  // Split only at sentence ends followed by a space so "Node.js" stays intact.
  const sentences = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/);
  const question = [...sentences].reverse().find((sentence) => sentence.includes('?'))?.trim() ?? '';
  return question.slice(0, PREVIOUS_QUESTION_CHARS);
};

/** Interviewer questions from this user's recent sessions on the same subject, newest first. */
async function loadPreviousQuestions(
  db: FirebaseFirestore.Firestore,
  uid: string,
  mode: InterviewMode,
  config: Partial<InterviewConfig>,
): Promise<string[]> {
  const key = subjectKey(mode, config);
  try {
    const snap = await db
      .collection('interviews')
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(PREVIOUS_INTERVIEWS_SCANNED)
      .select('mode', 'config', 'conversation', 'isDeleted')
      .get();

    const seen = new Set<string>();
    const questions: string[] = [];
    for (const doc of snap.docs) {
      const data = doc.data() as Partial<InterviewDoc>;
      if (data.isDeleted || !data.mode || !data.config) continue;
      if (subjectKey(data.mode, data.config) !== key) continue;
      for (const entry of data.conversation ?? []) {
        if (entry.role !== 'assistant' || !entry.text) continue;
        const question = extractQuestion(entry.text);
        const normalized = question.toLowerCase();
        if (!question || seen.has(normalized)) continue;
        seen.add(normalized);
        questions.push(question);
        if (questions.length >= PREVIOUS_QUESTIONS_LIMIT) return questions;
      }
    }
    return questions;
  } catch (error) {
    console.warn('[interview] could not load previous questions', error);
    return [];
  }
}

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
  /** Job description text when interview is created from a JD */
  jobDescriptionText?: string;
  /** Job Description document ID if launched from a JD */
  jdId?: string;
  /** Interview link ID if launched from an invitation link */
  interviewLinkId?: string;
  /** Candidate invite ID if launched from an invitation */
  inviteId?: string;
  /** Evaluation focus areas for JD-based interviews */
  focusAreas?: InterviewFocusAreas;
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
  readinessScore: number;
  scoreImprovement: number;
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

/** Rolling average for weeklyStats skill fields across interviews in the same week. */
function rollingWeekAverage(previous: number, previousCount: number, next: number): number {
  const safeNext = Number.isFinite(next) ? next : 0;
  if (previousCount <= 0) {
    return Math.round(Math.min(100, Math.max(0, safeNext)));
  }
  const safePrev = Number.isFinite(previous) ? previous : 0;
  return Math.round(
    Math.min(100, Math.max(0, (safePrev * previousCount + safeNext) / (previousCount + 1))),
  );
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
        jobDescriptionText: input.jobDescriptionText,
        jdId: input.jdId,
        interviewLinkId: input.interviewLinkId,
        inviteId: input.inviteId,
        focusAreas: input.focusAreas,
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
        jobDescriptionText: input.jobDescriptionText,
        jdId: input.jdId,
        interviewLinkId: input.interviewLinkId,
        inviteId: input.inviteId,
        focusAreas: input.focusAreas,
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
        jobDescriptionText: input.jobDescriptionText,
        jdId: input.jdId,
        interviewLinkId: input.interviewLinkId,
        inviteId: input.inviteId,
        focusAreas: input.focusAreas,
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
        jobDescriptionText: input.jobDescriptionText,
        jdId: input.jdId,
        interviewLinkId: input.interviewLinkId,
        inviteId: input.inviteId,
        focusAreas: input.focusAreas,
      },
    };
  }

  throw new AppError(
    400,
    'Provide difficulty and durationMinutes (with mode/technology), or templateId / companyId / quickStart.',
  );
}

/**
 * Resolves candidate's real display name and email address from Firestore or Firebase Auth.
 * Never defaults to a generic placeholder like "Candidate".
 */
async function resolveCandidateInfo(
  db: FirebaseFirestore.Firestore,
  uid: string,
): Promise<{ candidateName: string; candidateEmail: string }> {
  let email = '';
  let name = '';

  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      const data = userDoc.data()!;
      email = (data['email'] || '').toLowerCase().trim();
      name = (
        data['displayName'] ||
        data['name'] ||
        data['fullName'] ||
        (data['profile'] as any)?.fullName ||
        (data['profile'] as any)?.name ||
        ''
      ).trim();
    }
  } catch (err) {
    console.warn('[resolveCandidateInfo] Firestore user lookup failed:', err);
  }

  if (!email || !name || /^(candidate|user|anonymous|guest|null|undefined)$/i.test(name)) {
    try {
      const authUser = await getAuth().getUser(uid);
      if (!email && authUser.email) {
        email = authUser.email.toLowerCase().trim();
      }
      if ((!name || /^(candidate|user|anonymous|guest|null|undefined)$/i.test(name)) && authUser.displayName?.trim()) {
        name = authUser.displayName.trim();
      }
    } catch (err) {
      console.warn('[resolveCandidateInfo] Auth user lookup failed:', err);
    }
  }

  if ((!name || /^(candidate|user|anonymous|guest|null|undefined)$/i.test(name)) && email) {
    const prefix = email.split('@')[0].trim();
    name = prefix
      .replace(/[._+-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }

  if (!name || /^(candidate|user|anonymous|guest|null|undefined)$/i.test(name)) {
    name = email || 'Candidate';
  }

  return { candidateName: name, candidateEmail: email };
}

function interviewMatchesAssessment(
  data: FirebaseFirestore.DocumentData,
  jdId?: string,
  interviewLinkId?: string,
): boolean {
  if (data.isDeleted) return false;
  const docJd = String(data.config?.jdId || data.jdId || '');
  const docLink = String(data.config?.interviewLinkId || data.interviewLinkId || '');
  return (Boolean(interviewLinkId) && docLink === interviewLinkId) || (Boolean(jdId) && docJd === jdId);
}

function mapLinkDifficulty(raw: unknown): InterviewDifficulty {
  const value = String(raw || '').toLowerCase();
  if (value === 'easy') return 'easy';
  if (value === 'hard') return 'hard';
  return 'medium';
}

function mapLinkMode(raw: unknown): InterviewMode {
  const value = String(raw || '').toUpperCase();
  if (value === 'TECHNICAL') return 'coding';
  if (value === 'BEHAVIORAL') return 'behavioral';
  return 'conversational';
}

/**
 * Applies the admin interview-link settings and rejects a start once maxAttempts is used.
 * Returns the mode the live session should use.
 */
async function applyInterviewLinkOnStart(
  db: FirebaseFirestore.Firestore,
  uid: string,
  config: InterviewConfig,
  mode: InterviewMode,
  ids: { jdId?: string; interviewLinkId?: string },
): Promise<InterviewMode> {
  const loaded = await loadInterviewLink(db, ids);
  const link = loaded?.link;
  const linkDocId = loaded?.id || ids.interviewLinkId;
  const resolvedJdId = String(link?.jdId || ids.jdId || '').trim() || undefined;

  const maxAttempts = Math.max(1, Number(link?.candidateSettings?.maxAttempts) || 1);
  if (resolvedJdId || linkDocId) {
    const existing = await db
      .collection('interviews')
      .where('userId', '==', uid)
      .where('status', '==', 'completed')
      .orderBy('completedAt', 'desc')
      .limit(40)
      .get();
    const used = existing.docs.filter((doc) =>
      interviewMatchesAssessment(doc.data(), resolvedJdId, linkDocId),
    ).length;
    if (used >= maxAttempts) {
      throw new AppError(
        400,
        `You have used all ${maxAttempts} attempt${maxAttempts === 1 ? '' : 's'} for this interview. Open the link to view your previous score.`,
      );
    }
  }

  if (!link) return mode;

  if (link.candidateSettings?.requireEmailVerification === true) {
    const authUser = await getAuth().getUser(uid);
    if (!authUser.emailVerified) {
      throw new AppError(403, 'Verify your email before starting this interview.');
    }
  }

  const status = String(link.status || 'ACTIVE').toUpperCase();
  if (status !== 'ACTIVE') {
    throw new AppError(400, `This interview link is ${status.toLowerCase()}.`);
  }
  const expiresAt = link.expiresAt?.toDate?.() || (link.expiresAt ? new Date(link.expiresAt) : null);
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    throw new AppError(400, 'This interview link has expired.');
  }

  const duration = Number(link.durationMinutes);
  if (Number.isFinite(duration) && duration > 0) config.durationMinutes = Math.round(duration);
  config.difficulty = mapLinkDifficulty(link.difficulty);
  const settings = link.interviewSettings || {};
  config.cameraRequired = settings.cameraRequired !== false;
  config.microphoneRequired = settings.microphoneRequired !== false;
  config.tabSwitchDetection = settings.tabSwitchDetection !== false;
  config.autoSubmitOnTimeout = settings.autoSubmitOnTimeout !== false;
  config.showProgress = settings.showProgress !== false;
  if (linkDocId) config.interviewLinkId = linkDocId;
  if (resolvedJdId) config.jdId = resolvedJdId;
  return mapLinkMode(link.interviewType);
}

async function loadInterviewLink(
  db: FirebaseFirestore.Firestore,
  ids: { jdId?: string; interviewLinkId?: string },
): Promise<{ link: FirebaseFirestore.DocumentData; id: string } | null> {
  const collections = ['InterviewLinks', 'interviewLinks'];
  if (ids.interviewLinkId) {
    for (const name of collections) {
      const snap = await db.collection(name).doc(ids.interviewLinkId).get();
      if (snap.exists) {
        const data = snap.data();
        if (data) return { link: data, id: snap.id };
      }
    }
  }
  if (ids.jdId) {
    for (const name of collections) {
      const snap = await db.collection(name).where('jdId', '==', ids.jdId).limit(1).get();
      if (!snap.empty) {
        const data = snap.docs[0].data();
        if (data) return { link: data, id: snap.docs[0].id };
      }
    }
  }
  return null;
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
  let mode = resolved.mode;
  const config = omitUndefinedDeep(resolved.config);

  // When an interview is created from a Job Description, the JD is the sole assessment basis.
  const isJdInterview = Boolean(config.jobDescriptionText?.trim());
  if (isJdInterview) {
    delete config.resumeVersionUsed;
  }

  // resumeVersionUsed is only set when Setup explicitly opts in ("Using resume") for non-JD sessions.
  const useResume = !isJdInterview && Boolean(config.resumeVersionUsed);
  const resumeSnap = useResume ? await onboardingAnalysisRef(db, uid).get() : null;
  if (useResume && !resumeSnap?.exists) {
    throw new AppError(404, 'No resume analysis found for this account.');
  }
  if (!useResume) {
    delete config.resumeVersionUsed;
  }

  const targetJdId = config.jdId || input.jdId;
  const targetInviteId = config.inviteId || input.inviteId;
  const targetLinkId = config.interviewLinkId || input.interviewLinkId;

  if (targetInviteId) {
    const inviteDoc = await db.collection('candidateInvites').doc(targetInviteId).get();
    if (inviteDoc.exists && inviteDoc.data()?.status === 'REVOKED') {
      throw new AppError(403, 'This interview invitation was revoked.');
    }
  }

  mode = await applyInterviewLinkOnStart(db, uid, config, mode, {
    jdId: targetJdId,
    interviewLinkId: targetLinkId,
  });

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

  const [topicProfile, previousQuestions] = await Promise.all([
    loadTopicProfile(db, uid),
    loadPreviousQuestions(db, uid, mode, config),
  ]);
  const openingAngle = OPENING_ANGLES[Math.floor(Math.random() * OPENING_ANGLES.length)];

  const systemInstructions = buildInterviewSystemInstructions(mode, config, {
    resumeContext: resumeContext || undefined,
    previousWeaknesses,
    topicProfile,
    previousQuestions,
    openingAngle,
  });

  const geminiSessionConfig = buildGeminiSessionConfig(systemInstructions);

  const interviewDocRef = interviewRef(db, db.collection('interviews').doc().id);
  const now = FieldValue.serverTimestamp();
  const resolvedInviteId = config.inviteId || input.inviteId || null;
  const resolvedLinkId = config.interviewLinkId || input.interviewLinkId || null;
  const resolvedJdId = config.jdId || input.jdId || null;
  // invited > interview_link > onboarded (practice / in-app start)
  const interviewOrigin: 'invited' | 'interview_link' | 'onboarded' = resolvedInviteId
    ? 'invited'
    : resolvedLinkId
      ? 'interview_link'
      : 'onboarded';
  const isInterviewInvite = interviewOrigin === 'invited' || interviewOrigin === 'interview_link';

  const { candidateName, candidateEmail } = await resolveCandidateInfo(db, uid);

  await interviewDocRef.set({
    userId: uid,
    mode,
    status: 'created',
    config,
    isInterviewInvite,
    interviewInvite: isInterviewInvite,
    interviewOrigin,
    interviewLinkId: resolvedLinkId,
    inviteId: resolvedInviteId,
    jdId: resolvedJdId,
    candidateEmail: candidateEmail || null,
    candidateName: candidateName || null,
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

  // Asynchronously update candidate invitations matching this session/JD to STARTED
  void syncCandidateInvitesOnInterviewStart(
    db,
    uid,
    interviewDocRef.id,
    (config as any).jdId || input.jdId,
    (config as any).inviteId || input.inviteId,
    (config as any).interviewLinkId || input.interviewLinkId,
  );

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
 * Score + XP/skills pipeline. Gemini scoring runs before the transaction.
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
    codeSnippetQuestionsAsked: interview.codeSnippetQuestionsAsked ?? 0,
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
    };
    const prevXP = gamification.currentXP ?? 0;
    const prevLevel = gamification.level ?? 1;

    creditXpInTransaction(tx, db, uid, {
      amount: xpEarned,
      reason: 'interview_completed',
      relatedId: interviewId,
    });

    const runningXP = prevXP + xpEarned;
    const levelInfo = applyLevelUpdate(tx, db, uid, prevLevel, runningXP);
    const updatedSkills = writeSkillUpdates(tx, db, uid, currentSkills, results.skillDeltas);

    const score7dAgo =
      user.readiness?.readinessScore7dAgo ?? user.readiness?.score;
    const { readinessScore } = writeReadiness(
      tx,
      db,
      uid,
      {
        technical: results.technicalScore,
        communication: results.communicationScore,
        confidence: results.confidenceScore,
        problemSolving: results.problemSolvingScore,
        ...(typeof results.codingScore === 'number'
          ? { coding: results.codingScore }
          : {}),
        ...(typeof results.behaviorScore === 'number'
          ? { behavior: results.behaviorScore }
          : {}),
      },
      score7dAgo,
    );

    const minutes = Math.round(durationSec / 60);
    const prevStats = statsSnap.exists
      ? (statsSnap.data() as {
          longestSessionSec?: number;
          interviewsCompleted?: number;
          technical?: number;
          communication?: number;
          confidence?: number;
          problemSolving?: number;
          coding?: number;
          behavior?: number;
          hiringProbability?: number;
        })
      : null;
    const prevLongestSec = prevStats?.longestSessionSec ?? 0;
    const isNewLongest = durationSec > prevLongestSec;
    const prevInterviewCount = prevStats?.interviewsCompleted ?? 0;

    // Store this week's interview scores (rolling avg), not EMA skill docs that
    // start at DEFAULT_SKILL_SCORE=50 and land near ~49 after one interview.
    const weekScores = {
      technical: rollingWeekAverage(
        prevStats?.technical ?? 0,
        prevInterviewCount,
        results.technicalScore,
      ),
      communication: rollingWeekAverage(
        prevStats?.communication ?? 0,
        prevInterviewCount,
        results.communicationScore,
      ),
      confidence: rollingWeekAverage(
        prevStats?.confidence ?? 0,
        prevInterviewCount,
        results.confidenceScore,
      ),
      problemSolving: rollingWeekAverage(
        prevStats?.problemSolving ?? 0,
        prevInterviewCount,
        results.problemSolvingScore,
      ),
      coding:
        typeof results.codingScore === 'number'
          ? rollingWeekAverage(prevStats?.coding ?? 0, prevInterviewCount, results.codingScore)
          : (prevStats?.coding ?? 0),
      behavior:
        typeof results.behaviorScore === 'number'
          ? rollingWeekAverage(prevStats?.behavior ?? 0, prevInterviewCount, results.behaviorScore)
          : (prevStats?.behavior ?? 0),
      hiringProbability: rollingWeekAverage(
        prevStats?.hiringProbability ?? 0,
        prevInterviewCount,
        results.overallScore,
      ),
    };

    if (statsSnap.exists) {
      tx.update(statsRef, {
        ...weekScores,
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
        ...weekScores,
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
        // XP rewards are disabled app-wide — goals still complete, just without a bonus.
        tx.update(goalDoc.ref, { status: 'done' });
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
      ...(user.email ? { candidateEmail: user.email.toLowerCase().trim() } : {}),
      ...(user.displayName || (user as any).name || (user.profile as any)?.fullName
        ? { candidateName: user.displayName || (user as any).name || (user.profile as any)?.fullName }
        : {}),
    });

    const previousOverallScore = user.stats?.lastOverallScore;
    const scoreImprovement =
      typeof previousOverallScore === 'number'
        ? Math.max(0, results.overallScore - previousOverallScore)
        : 0;

    tx.update(userRef(db, uid), {
      'stats.totalInterviews': FieldValue.increment(1),
      'stats.lastOverallScore': results.overallScore,
      ...(results.overallScore >= 70
        ? { 'stats.successfulInterviews': FieldValue.increment(1) }
        : {}),
    });

    return {
      xpEarned,
      newLevel: resolveLevel(runningXP).level,
      levelUp: levelInfo.levelUp || resolveLevel(runningXP).level > prevLevel,
      updatedSkills,
      readinessScore,
      scoreImprovement,
    };
  });

  await checkAchievements(uid, {
    completed: true,
    overallScore: results.overallScore,
    xpEarned: txResult.xpEarned,
    success: results.overallScore >= 70,
    deliveryScore: results.communicationScore,
    contentScore: results.technicalScore,
    scoreImprovement: txResult.scoreImprovement,
    skillScores: {
      technical: results.technicalScore,
      communication: results.communicationScore,
      confidence: results.confidenceScore,
      problemSolving: results.problemSolvingScore,
      behavior: results.behaviorScore ?? 0,
    },
  }).catch((err: unknown) => {
    console.error('[completeInterview] checkAchievements failed', err);
  });
  const answeredCount =
    countCandidateAnswers(interview.conversation) ||
    countCandidateAnswersFromTranscript(resolvedTranscript);
  if (answeredCount > 0) {
    await generateReport(uid, interviewId, results).catch((err: unknown) => {
      console.error('[completeInterview] generateReport failed', err);
    });
  }
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
    await evaluateWeekInterview(
      uid,
      roadmapActivity.roadmapId,
      roadmapActivity.week,
      results.overallScore,
      interviewId,
    ).catch((err: unknown) => {
      console.error('[completeInterview] evaluateWeekInterview failed', err);
    });
  }

  // Asynchronously update candidateInvites to COMPLETED with score (matching JD / session)
  const interviewJdId = (interview.config as any)?.jdId || (interview as any).jdId;
  const interviewLinkId = (interview.config as any)?.interviewLinkId || (interview as any).interviewLinkId;
  const inviteId = (interview.config as any)?.inviteId || (interview as any).inviteId;
  void syncCandidateInvitesOnInterviewComplete(
    db,
    uid,
    interviewId,
    results,
    interviewJdId,
    interviewLinkId,
    inviteId,
  );

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

/** Sync candidateInvites collection when an interview starts. */
async function syncCandidateInvitesOnInterviewStart(
  db: FirebaseFirestore.Firestore,
  uid: string,
  interviewId: string,
  jdId?: string,
  inviteId?: string,
  interviewLinkId?: string,
): Promise<void> {
  try {
    const { candidateName, candidateEmail: email } = await resolveCandidateInfo(db, uid);
    if (!email && !candidateName) return;

    if (interviewLinkId && !jdId) {
      try {
        const linkSnap = await db.collection('InterviewLinks').doc(interviewLinkId).get();
        if (linkSnap.exists) {
          jdId = linkSnap.data()?.jdId || jdId;
        }
      } catch {}
    }

    if (jdId && !interviewLinkId) {
      try {
        const linkSnap = await db.collection('InterviewLinks').where('jdId', '==', jdId).limit(1).get();
        if (!linkSnap.empty) {
          interviewLinkId = linkSnap.docs[0].id;
        }
      } catch {}
    }

    if (inviteId) {
      const directDoc = await db.collection('candidateInvites').doc(inviteId).get();
      if (directDoc.exists && directDoc.data()?.status !== 'REVOKED') {
        await directDoc.ref.update({
          status: 'STARTED',
          startedAt: FieldValue.serverTimestamp(),
          interviewSessionId: interviewId,
          interviewId,
          ...(candidateName && (!directDoc.data()?.name || /^(candidate|user|anonymous|guest)$/i.test(directDoc.data()?.name))
            ? { name: candidateName }
            : {}),
        });
        return;
      }
      const tokenDoc = await db.collection('interviewInvites').doc(inviteId).get();
      if (tokenDoc.exists && tokenDoc.data()?.status !== 'cancelled') {
        await tokenDoc.ref.update({
          status: 'started',
          attemptCount: 1,
          startedAt: FieldValue.serverTimestamp(),
          interviewId,
        });
        return;
      }
    }

    const queries: Array<Promise<FirebaseFirestore.QuerySnapshot>> = [];
    if (email) {
      if (interviewLinkId) {
        queries.push(
          db
            .collection('candidateInvites')
            .where('email', '==', email)
            .where('interviewLinkId', '==', interviewLinkId)
            .where('status', 'in', ['SENT', 'DELIVERED', 'OPENED'])
            .get(),
        );
      }
      if (jdId) {
        queries.push(
          db
            .collection('candidateInvites')
            .where('email', '==', email)
            .where('jdId', '==', jdId)
            .where('status', 'in', ['SENT', 'DELIVERED', 'OPENED'])
            .get(),
        );
      }
    }

    const snaps = await Promise.all(queries);
    const matchingDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    snaps.forEach(s => s.docs.forEach(d => matchingDocs.push(d)));

    if (matchingDocs.length > 0) {
      matchingDocs.sort((a, b) => {
        const aTime = a.data().sentAt?.toMillis?.() || 0;
        const bTime = b.data().sentAt?.toMillis?.() || 0;
        return bTime - aTime;
      });
      const targetDoc = matchingDocs[0];
      await targetDoc.ref.update({
        status: 'STARTED',
        startedAt: FieldValue.serverTimestamp(),
        interviewSessionId: interviewId,
        interviewId,
        ...(candidateName && (!targetDoc.data()?.name || /^(candidate|user|anonymous|guest)$/i.test(targetDoc.data()?.name))
          ? { name: candidateName }
          : {}),
      });
    } else if (interviewLinkId || jdId) {
      // Auto-create candidateInvites entry for direct copied link attempts
      const targetId = interviewLinkId || jdId!;
      let jobTitle = 'AI Assessment';
      let companyName = 'InterviewUp';
      let interviewLinkName = 'Candidate Assessment';

      try {
        if (interviewLinkId) {
          const linkSnap = await db.collection('InterviewLinks').doc(interviewLinkId).get();
          if (linkSnap.exists) {
            const lData = linkSnap.data()!;
            interviewLinkName = lData.name || interviewLinkName;
            jobTitle = lData.name || jobTitle;
          }
        }
        if (jdId) {
          const jdSnap = await db.collection('jobDescription').doc(jdId).get();
          if (jdSnap.exists) {
            const jData = jdSnap.data()!;
            jobTitle = jData.title || jobTitle;
            companyName = jData.companyName || companyName;
          }
        }
      } catch {
        // non-fatal
      }

      const newInviteRef = db.collection('candidateInvites').doc();
      await newInviteRef.set({
        interviewLinkId: interviewLinkId || targetId,
        jdId: jdId || targetId,
        email: email || '',
        name: candidateName,
        inviteUrl: `https://www.app.interviewup.ai/jd-view/${targetId}`,
        status: 'STARTED',
        sentAt: FieldValue.serverTimestamp(),
        sentBy: 'direct_link',
        startedAt: FieldValue.serverTimestamp(),
        interviewSessionId: interviewId,
        interviewId,
        jobTitle,
        companyName,
        interviewLinkName,
      });
    }
  } catch (err) {
    console.warn('[syncCandidateInvitesOnInterviewStart] Failed to sync candidate invites:', err);
  }
}

/** Sync candidateInvites and interviewInvites collections when an interview completes. */
async function syncCandidateInvitesOnInterviewComplete(
  db: FirebaseFirestore.Firestore,
  uid: string,
  interviewId: string,
  results: InterviewResults,
  jdId?: string,
  interviewLinkId?: string,
  inviteId?: string,
): Promise<void> {
  try {
    const { candidateName, candidateEmail: email } = await resolveCandidateInfo(db, uid);
    const score = typeof results.overallScore === 'number' ? Math.round(results.overallScore) : null;

    // 1. If explicit inviteId passed, try updating candidateInvites and interviewInvites
    if (inviteId) {
      const inviteSnap = await db.collection('candidateInvites').doc(inviteId).get();
      if (inviteSnap.exists && inviteSnap.data()?.status !== 'REVOKED') {
        await inviteSnap.ref.update({
          status: 'COMPLETED',
          score,
          completedAt: FieldValue.serverTimestamp(),
          interviewSessionId: interviewId,
          interviewId,
          ...(candidateName && (!inviteSnap.data()?.name || /^(candidate|user|anonymous|guest)$/i.test(inviteSnap.data()?.name))
            ? { name: candidateName }
            : {}),
        });
      }

      const tokenInviteSnap = await db.collection('interviewInvites').doc(inviteId).get();
      if (tokenInviteSnap.exists && tokenInviteSnap.data()?.status !== 'cancelled') {
        await tokenInviteSnap.ref.update({
          status: 'completed',
          score,
          attemptCount: 1,
          completedAt: FieldValue.serverTimestamp(),
          interviewId,
        });
      }
    }

    // 2. Also sync token-based interviewInvites matching this interviewId
    const tokenInvitesByIvSnap = await db
      .collection('interviewInvites')
      .where('interviewId', '==', interviewId)
      .get();
    for (const doc of tokenInvitesByIvSnap.docs) {
      if (doc.data()?.status !== 'cancelled') {
        await doc.ref.update({
          status: 'completed',
          score,
          attemptCount: 1,
          completedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    // 3. Sync candidateInvites collection
    const queries: Array<Promise<FirebaseFirestore.QuerySnapshot>> = [];
    queries.push(
      db
        .collection('candidateInvites')
        .where('interviewSessionId', '==', interviewId)
        .get(),
    );
    queries.push(
      db
        .collection('candidateInvites')
        .where('interviewId', '==', interviewId)
        .get(),
    );

    let resolvedJdId = jdId;
    let resolvedLinkId = interviewLinkId;

    if (interviewLinkId && !resolvedJdId) {
      try {
        const linkSnap = await db.collection('InterviewLinks').doc(interviewLinkId).get();
        if (linkSnap.exists) {
          resolvedJdId = linkSnap.data()?.jdId || resolvedJdId;
        }
      } catch {}
    }

    if (jdId && !resolvedLinkId) {
      try {
        const linkSnap = await db.collection('InterviewLinks').where('jdId', '==', jdId).limit(1).get();
        if (!linkSnap.empty) {
          resolvedLinkId = linkSnap.docs[0].id;
        }
      } catch {}
    }

    if (email) {
      if (resolvedLinkId) {
        queries.push(
          db
            .collection('candidateInvites')
            .where('email', '==', email)
            .where('interviewLinkId', '==', resolvedLinkId)
            .get(),
        );
      }
      if (resolvedJdId) {
        queries.push(
          db
            .collection('candidateInvites')
            .where('email', '==', email)
            .where('jdId', '==', resolvedJdId)
            .get(),
        );
      }
    }

    const snapshots = await Promise.all(queries);
    const batch = db.batch();
    const seenIds = new Set<string>();
    let count = 0;

    for (const snap of snapshots) {
      for (const doc of snap.docs) {
        if (seenIds.has(doc.id)) continue;
        const data = doc.data();
        if (data.status === 'REVOKED') continue;
        seenIds.add(doc.id);
        batch.update(doc.ref, {
          status: 'COMPLETED',
          score,
          completedAt: FieldValue.serverTimestamp(),
          interviewSessionId: interviewId,
          interviewId,
          ...(candidateName && (!data.name || /^(candidate|user|anonymous|guest)$/i.test(data.name))
            ? { name: candidateName }
            : {}),
          ...(resolvedLinkId ? { interviewLinkId: resolvedLinkId } : {}),
          ...(resolvedJdId ? { jdId: resolvedJdId } : {}),
        });
        count++;
      }
    }

    if (count > 0) {
      await batch.commit();
    } else if (count === 0 && (resolvedLinkId || resolvedJdId)) {
      // Direct copied link attempt: create completed candidateInvites record
      const targetId = resolvedLinkId || resolvedJdId!;
      let jobTitle = 'AI Assessment';
      let companyName = 'InterviewUp';
      let interviewLinkName = 'Candidate Assessment';

      try {
        if (resolvedLinkId) {
          const linkSnap = await db.collection('InterviewLinks').doc(resolvedLinkId).get();
          if (linkSnap.exists) {
            const lData = linkSnap.data()!;
            interviewLinkName = lData.name || interviewLinkName;
            jobTitle = lData.name || jobTitle;
          }
        }
        if (resolvedJdId) {
          const jdSnap = await db.collection('jobDescription').doc(resolvedJdId).get();
          if (jdSnap.exists) {
            const jData = jdSnap.data()!;
            jobTitle = jData.title || jobTitle;
            companyName = jData.companyName || companyName;
          }
        }
      } catch {
        // non-fatal
      }

      const newInviteRef = db.collection('candidateInvites').doc();
      await newInviteRef.set({
        interviewLinkId: resolvedLinkId || targetId,
        jdId: resolvedJdId || targetId,
        email: email || '',
        name: candidateName,
        inviteUrl: `https://www.app.interviewup.ai/jd-view/${targetId}`,
        status: 'COMPLETED',
        score,
        sentAt: FieldValue.serverTimestamp(),
        sentBy: 'direct_link',
        startedAt: FieldValue.serverTimestamp(),
        completedAt: FieldValue.serverTimestamp(),
        interviewSessionId: interviewId,
        interviewId,
        jobTitle,
        companyName,
        interviewLinkName,
      });
    }
  } catch (err) {
    console.warn('[syncCandidateInvitesOnInterviewComplete] Failed to sync candidate invites:', err);
  }
}
