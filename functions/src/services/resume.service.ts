/**
 * V2 resume service — multipart PDF analyze + upsert.
 * When onboarding=true, also generates a full interview-prep onboarding plan.
 */

import { randomUUID } from 'crypto';
import { FieldValue, type Timestamp } from 'firebase-admin/firestore';
import type {
  AnalyzeResumeApiResult,
  ResumeAnalysis,
  ResumeDoc,
  ResumeOnboardingPlan,
} from '../interfaces/resume.interface';
import type { UserOnboardingSnapshot } from '../interfaces/user.interface';
import { generateJson, RESUME_GEMINI_MODEL } from '../library/gemini-client';
import {
  buildCombinedResumeSystemInstruction,
  buildCombinedResumeUserPrompt,
} from '../modules/interview/prompts/resume-combined.prompt';
import {
  buildResumeOnboardingSystemInstruction,
  buildResumeOnboardingUserPrompt,
} from '../modules/interview/prompts/resume-onboarding.prompt';
import {
  buildResumeReviewSystemInstruction,
  buildResumeReviewUserPrompt,
} from '../modules/interview/prompts/resume-review.prompt';
import { uploadUserResumeFile } from '../modules/storage/storage.service';
import { AppError } from '../shared/utils';
import { logger } from '../shared/logger';
import { extractPdfText } from '../shared/utils/pdf';
import { ensureAdmin } from '../utils/callable-auth';
import {
  onboardingAnalysisRef,
  userRef,
} from '../utils/firestore-refs';
import {
  extractCandidateNameFromResumeText,
  namesBelongToSamePerson,
} from './resume-name-match';
import {
  normalizeRawResumeReview,
  resumeReviewSchema,
  type ResumeReviewParsed,
} from './resume-analysis.schema';
import {
  resumeOnboardingPlanSchema,
  type ResumeOnboardingPlanParsed,
} from './resume-onboarding.schema';

/** Resume text sent to Gemini — keeps prompts fast without losing signal. */
const RESUME_PROMPT_CHARS = 12_000;
/** Stored extracted text cap (smaller writes on re-analyze). */
const STORED_EXTRACTED_TEXT_CHARS = 20_000;

/**
 * Builds the full superset `ResumeAnalysis` (legacy flat fields + rich results-page
 * fields) from Gemini's rich output. Legacy fields are pure derivations — Gemini never
 * generates them directly — so the current Angular page keeps rendering unchanged.
 */
function buildResumeAnalysisFromReview(
  parsed: ResumeReviewParsed,
  extractedText: string,
): ResumeAnalysis {
  const fixesFirst = [...parsed.suggestions]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 5)
    .map((s) => ({ id: s.id, severity: s.severity, text: s.text }));

  const workingWell = parsed.strengths
    .slice(0, 5)
    .map((s) => ({ id: s.id, text: s.text }));

  return {
    isCoder: parsed.isCoder,
    // Legacy (derived)
    overallScore: parsed.scores.overall,
    atsScore: parsed.scores.ats,
    impactScore: parsed.scores.impact,
    clarityScore: parsed.scores.content,
    keywordMatch: parsed.detailedMetrics.keywordMatch,
    quantifiedImpact: parsed.detailedMetrics.quantifiedImpact,
    actionVerbs: parsed.detailedMetrics.actionVerbs,
    structureLength: parsed.detailedMetrics.structureLength,
    percentileVsPeers: parsed.scores.peerPercentile ?? Math.max(0, parsed.scores.overall - 5),
    fixesFirst,
    workingWell,
    extractedKeywords: parsed.keywords.matched.map((k) => k.keyword),
    missingKeywords: parsed.keywords.missing.map((k) => k.keyword),
    recommendedSkills: parsed.recommendedSkills,
    recommendedInterviewIds: parsed.recommendedInterviewIds,
    extractedText: extractedText.slice(0, STORED_EXTRACTED_TEXT_CHARS),

    // Rich results-page contract
    experienceLevel: parsed.experienceLevel,
    scores: parsed.scores,
    atsFriendly: parsed.scores.ats >= 70,
    scoreLabels: parsed.scoreLabels,
    strengths: parsed.strengths,
    areasToImprove: parsed.areasToImprove,
    suggestions: parsed.suggestions,
    aiFeedback: parsed.aiFeedback,
    sections: parsed.sections,
    keywords: parsed.keywords,
    ats: parsed.ats,
    roleMatches: parsed.roleMatches,
    detailedMetrics: parsed.detailedMetrics,
  };
}

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && 'text' in item) {
        return String((item as { text: unknown }).text ?? '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

const PRIORITIES = new Set(['High', 'Medium', 'Low']);
const SKILL_LEVELS = new Set(['Beginner', 'Intermediate', 'Advanced', 'Expert']);
const RESOURCE_TYPES = new Set([
  'Official Docs',
  'Course',
  'Book',
  'YouTube',
  'Practice Platform',
  'GitHub',
]);

function asPriority(raw: unknown, fallback: 'High' | 'Medium' | 'Low' = 'Medium') {
  return typeof raw === 'string' && PRIORITIES.has(raw)
    ? (raw as 'High' | 'Medium' | 'Low')
    : fallback;
}

function asSkillLevel(raw: unknown, fallback: 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert' = 'Intermediate') {
  return typeof raw === 'string' && SKILL_LEVELS.has(raw)
    ? (raw as 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert')
    : fallback;
}

function asResourceType(
  raw: unknown,
): 'Official Docs' | 'Course' | 'Book' | 'YouTube' | 'Practice Platform' | 'GitHub' {
  return typeof raw === 'string' && RESOURCE_TYPES.has(raw)
    ? (raw as 'Official Docs' | 'Course' | 'Book' | 'YouTube' | 'Practice Platform' | 'GitHub')
    : 'Course';
}

function clampScore(n: unknown, fallback = 0): number {
  const value = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampStringList(raw: unknown, min: number, max: number, fallback: string[] = []): string[] {
  const list = asStringArray(raw);
  if (list.length >= min) return list.slice(0, max);
  const merged = [...list];
  for (const item of fallback) {
    if (merged.length >= max) break;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (merged.some((v) => v.toLowerCase() === trimmed.toLowerCase())) continue;
    merged.push(trimmed);
  }
  while (merged.length < min && merged.length < max) {
    merged.push(`Skill ${merged.length + 1}`);
  }
  return merged.slice(0, max);
}

function deriveLearningTechnologies(
  raw: unknown,
  fallbackSources: {
    skillGapAnalysis: Array<{ name: string }>;
    recommendedProjectSkills: string[];
    careerPath: Array<{ title: string }>;
    recommendedInterviewTracks: string[];
    priorityPreparationAreas: string[];
  },
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  };

  asStringArray(raw).forEach(add);

  if (result.length < 4) {
    fallbackSources.skillGapAnalysis.forEach((item) => add(item.name));
  }
  if (result.length < 4) {
    fallbackSources.recommendedProjectSkills.forEach(add);
  }
  if (result.length < 4) {
    fallbackSources.careerPath.forEach((item) => add(item.title));
  }
  if (result.length < 4) {
    fallbackSources.recommendedInterviewTracks.forEach(add);
  }
  if (result.length < 4) {
    fallbackSources.priorityPreparationAreas.forEach(add);
  }

  return result.slice(0, 12);
}

/** Soft-normalize Gemini onboarding drift before strict zod validation. */
export function normalizeRawOnboarding(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const data = raw as Record<string, unknown>;

  const careerPath = Array.isArray(data.careerPath)
    ? data.careerPath.map((item, index) => {
        const obj = (item ?? {}) as Record<string, unknown>;
        const title = String(obj.title ?? `Topic ${index + 1}`).trim();
        const id =
          typeof obj.id === 'string' && obj.id.trim()
            ? obj.id.trim()
            : title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '') || `topic-${index + 1}`;
        return {
          id,
          title,
          description: String(obj.description ?? title).trim(),
          priority: asPriority(obj.priority),
          estimatedHours:
            typeof obj.estimatedHours === 'number' ? obj.estimatedHours : 8,
          completed: false,
          order: typeof obj.order === 'number' ? obj.order : index + 1,
        };
      })
    : [];

  const recommendedCompanies = Array.isArray(data.recommendedCompanies)
    ? data.recommendedCompanies.map((item, index) => {
        const obj = (item ?? {}) as Record<string, unknown>;
        const name = String(obj.name ?? `Company ${index + 1}`).trim();
        let website = String(obj.website ?? '').trim();
        if (website) {
          website = website
            .replace(/^https?:\/\//i, '')
            .replace(/^www\./i, '')
            .replace(/\/.*$/, '')
            .trim();
        }
        if (!website) {
          website = `${name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '')
            .slice(0, 40)}.com`;
        }
        return {
          name,
          website,
          reason: String(obj.reason ?? 'Relevant to your resume skills').trim(),
          skills: clampStringList(obj.skills, 2, 5),
          priority: typeof obj.priority === 'number' ? obj.priority : index + 1,
        };
      })
    : [];

  const recommendedSessionsRaw = Array.isArray(data.recommendedSessions)
    ? data.recommendedSessions.map((item, index) => {
        const obj = (item ?? {}) as Record<string, unknown>;
        const name = String(obj.name ?? obj.skill ?? `Skill ${index + 1}`).trim();
        const title = String(
          obj.title ?? `${name} interview prep`,
        ).trim();
        return {
          title,
          name,
          subskills: clampStringList(obj.subskills ?? obj.skills, 2, 5),
        };
      })
    : [];

  const skillGapAnalysis = Array.isArray(data.skillGapAnalysis)
    ? data.skillGapAnalysis.map((item) => {
        const obj = (item ?? {}) as Record<string, unknown>;
        return {
          name: String(obj.name ?? 'Skill').trim(),
          currentLevel: asSkillLevel(obj.currentLevel),
          targetLevel: asSkillLevel(obj.targetLevel, 'Advanced'),
          priority: asPriority(obj.priority),
          reason: String(obj.reason ?? 'Important for target role interviews').trim(),
          estimatedHours:
            typeof obj.estimatedHours === 'number' ? obj.estimatedHours : 8,
        };
      })
    : [];

  const learningRoadmap = Array.isArray(data.learningRoadmap)
    ? data.learningRoadmap.map((item, index) => {
        const obj = (item ?? {}) as Record<string, unknown>;
        return {
          week: typeof obj.week === 'number' ? obj.week : index + 1,
          title: String(obj.title ?? `Week ${index + 1}`).trim(),
          topics: asStringArray(obj.topics),
          hours: typeof obj.hours === 'number' ? obj.hours : 10,
          goal: String(obj.goal ?? 'Complete weekly milestones').trim(),
          checkpoint: String(obj.checkpoint ?? 'Review progress').trim(),
          mockInterview: String(obj.mockInterview ?? 'Practice mock interview').trim(),
        };
      })
    : [];

  const interviewPreparation = Array.isArray(data.interviewPreparation)
    ? data.interviewPreparation.map((item) => {
        const obj = (item ?? {}) as Record<string, unknown>;
        return {
          category: String(obj.category ?? 'Technical').trim(),
          questionsCount:
            typeof obj.questionsCount === 'number' ? obj.questionsCount : 10,
          priority: asPriority(obj.priority),
          recommendation: String(
            obj.recommendation ?? 'Practice regularly with mock interviews',
          ).trim(),
        };
      })
    : [];

  const recommendedProjects = Array.isArray(data.recommendedProjects)
    ? data.recommendedProjects.map((item) => {
        const obj = (item ?? {}) as Record<string, unknown>;
        return {
          title: String(obj.title ?? 'Portfolio Project').trim(),
          description: String(obj.description ?? 'Build to strengthen resume gaps').trim(),
          skills: asStringArray(obj.skills),
          estimatedHours:
            typeof obj.estimatedHours === 'number' ? obj.estimatedHours : 20,
          priority: asPriority(obj.priority),
        };
      })
    : [];

  const recommendedCertifications = Array.isArray(data.recommendedCertifications)
    ? data.recommendedCertifications.map((item) => {
        const obj = (item ?? {}) as Record<string, unknown>;
        return {
          name: String(obj.name ?? 'Certification').trim(),
          provider: String(obj.provider ?? 'Provider').trim(),
          reason: String(obj.reason ?? 'Relevant to target role').trim(),
          priority: asPriority(obj.priority),
        };
      })
    : [];

  const recommendedResources = Array.isArray(data.recommendedResources)
    ? data.recommendedResources.map((item) => {
        const obj = (item ?? {}) as Record<string, unknown>;
        const url = typeof obj.url === 'string' && obj.url.trim() ? obj.url.trim() : undefined;
        return {
          title: String(obj.title ?? 'Resource').trim(),
          type: asResourceType(obj.type),
          ...(url ? { url } : {}),
          reason: String(obj.reason ?? 'Helpful for preparation').trim(),
        };
      })
    : [];

  const nextActions = Array.isArray(data.nextActions)
    ? data.nextActions.map((item, index) => {
        const obj = (item ?? {}) as Record<string, unknown>;
        return {
          order: typeof obj.order === 'number' ? obj.order : index + 1,
          action: String(obj.action ?? `Action ${index + 1}`).trim(),
          priority: asPriority(obj.priority, index < 3 ? 'High' : 'Medium'),
          ...(typeof obj.estimatedHours === 'number'
            ? { estimatedHours: obj.estimatedHours }
            : {}),
        };
      })
    : [];

  const marketRaw =
    data.marketReadinessScore && typeof data.marketReadinessScore === 'object'
      ? (data.marketReadinessScore as Record<string, unknown>)
      : {};

  const expectedSalaryBand =
    typeof marketRaw.expectedSalaryBand === 'string' &&
    marketRaw.expectedSalaryBand.trim()
      ? marketRaw.expectedSalaryBand.trim()
      : undefined;

  const recommendedProjectSkills = recommendedProjects.flatMap((project) => project.skills);

  let recommendedSessions = recommendedSessionsRaw.slice(0, 10);
  if (recommendedSessions.length === 0) {
    const trackFallback = asStringArray(data.recommendedInterviewTracks);
    const gapFallback = skillGapAnalysis.map((item) => item.name);
    const names = (trackFallback.length > 0 ? trackFallback : gapFallback).slice(0, 10);
    recommendedSessions = names.map((name) => ({
      title: `${name} interview prep`,
      name,
      subskills: clampStringList([], 2, 5, [name, `${name} fundamentals`, `${name} advanced`]),
    }));
  }
  if (recommendedSessions.length === 0) {
    recommendedSessions = [
      {
        title: 'Technical interview prep',
        name: 'Technical',
        subskills: clampStringList([], 2, 5, ['Coding', 'System Design', 'Problem Solving']),
      },
    ];
  }

  const recommendedLearningTechnologies = deriveLearningTechnologies(
    data.recommendedLearningTechnologies,
    {
      careerPath,
      skillGapAnalysis,
      recommendedProjectSkills,
      recommendedInterviewTracks: asStringArray(data.recommendedInterviewTracks),
      priorityPreparationAreas: asStringArray(data.priorityPreparationAreas),
    },
  );

  return {
    careerPath: careerPath.slice(0, 30),
    recommendedCompanies: recommendedCompanies.slice(0, 10),
    recommendedSessions: recommendedSessions.slice(0, 10),
    skillGapAnalysis,
    learningRoadmap: learningRoadmap.slice(0, 8),
    interviewPreparation,
    recommendedInterviewTracks: asStringArray(data.recommendedInterviewTracks).length
      ? asStringArray(data.recommendedInterviewTracks)
      : recommendedSessions.map((s) => s.name).slice(0, 6),
    recommendedLearningTechnologies,
    resumeStrengthSummary: String(
      data.resumeStrengthSummary ?? 'Resume shows solid foundational experience.',
    ).trim(),
    priorityPreparationAreas: asStringArray(data.priorityPreparationAreas),
    estimatedPreparationWeeks:
      typeof data.estimatedPreparationWeeks === 'number'
        ? data.estimatedPreparationWeeks
        : 6,
    confidencePrediction: clampScore(data.confidencePrediction, 60),
    industryRecommendation: String(
      data.industryRecommendation ?? 'Technology',
    ).trim(),
    jobRoleRecommendation: String(
      data.jobRoleRecommendation ?? 'Professional',
    ).trim(),
    experienceLevelPrediction: String(
      data.experienceLevelPrediction ?? 'Mid-level',
    ).trim(),
    resumeCompleteness: clampScore(data.resumeCompleteness, 60),
    marketReadinessScore: {
      overallScore: clampScore(marketRaw.overallScore, 60),
      strengths: asStringArray(marketRaw.strengths),
      weaknesses: asStringArray(marketRaw.weaknesses),
      hiringReadiness: String(
        marketRaw.hiringReadiness ?? 'Needs focused preparation before interviews',
      ).trim(),
      ...(expectedSalaryBand ? { expectedSalaryBand } : {}),
    },
    recommendedProjects: recommendedProjects.slice(0, 10),
    recommendedCertifications: recommendedCertifications.slice(0, 5),
    recommendedResources,
    nextActions: nextActions.slice(0, 10),
  };
}

export interface AnalyzeResumeInput {
  fileBuffer: Buffer;
  fileName: string;
  /** Optional — when omitted, ATS/onboarding infer the role from the resume. */
  targetRole?: string;
  /**
   * When true, generate onboarding plan once (first time only).
   * If analysis.onboarding already exists, it is preserved forever — never regenerated.
   */
  onboarding?: boolean;
}

/** Prompt role when the client does not send targetRole (e.g. onboarding upload). */
function resolvePromptTargetRole(targetRole?: string): string {
  const trimmed = targetRole?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed
    : "Infer the most likely target role from the resume itself";
}

/**
 * Ensure the uploaded resume belongs to the signed-in user.
 * Throws AppError(400) on mismatch — analysis must not be completed/persisted.
 */
async function assertResumeBelongsToUser(
  uid: string,
  extractedText: string,
): Promise<void> {
  const db = ensureAdmin();
  const userSnap = await userRef(db, uid).get();
  const registeredName = String(userSnap.data()?.displayName ?? '').trim();

  if (!registeredName) {
    logger.warn('[resume.service] skipping name match — user has no displayName', {
      uid,
    });
    return;
  }

  const resumeName = extractCandidateNameFromResumeText(extractedText);
  if (!resumeName) {
    logger.warn('[resume.service] could not extract candidate name from resume text', {
      uid,
    });
    throw new AppError(
      400,
      'We could not find a clear name on this resume. Please upload a resume that includes your full name at the top.',
    );
  }

  if (!namesBelongToSamePerson(registeredName, resumeName)) {
    throw new AppError(
      400,
      `The name on this resume ("${resumeName}") does not match your registered name ("${registeredName}"). Please upload your own resume.`,
    );
  }
}

async function runAtsAnalysis(
  extractedText: string,
  targetRole?: string,
): Promise<ResumeAnalysis> {
  const resumeText = extractedText.slice(0, RESUME_PROMPT_CHARS);
  const resolvedTargetRole = resolvePromptTargetRole(targetRole);
  const rawAnalysis = await generateJson<unknown>({
    model: RESUME_GEMINI_MODEL,
    maxOutputTokens: 4096,
    temperature: 0.15,
    systemInstruction: buildResumeReviewSystemInstruction(),
    userPrompt: buildResumeReviewUserPrompt({
      targetRole: resolvedTargetRole,
      resumeText,
    }),
  });

  const validated = resumeReviewSchema.safeParse(
    normalizeRawResumeReview(rawAnalysis, targetRole),
  );
  if (!validated.success) {
    throw new AppError(
      502,
      `Invalid resume analysis from Gemini: ${validated.error.message}`,
    );
  }

  return buildResumeAnalysisFromReview(validated.data, extractedText);
}

/** One Gemini round-trip for ATS + onboarding (first-time onboarding). */
async function runCombinedResumeAnalysis(
  extractedText: string,
  targetRole?: string,
): Promise<{ ats: ResumeAnalysis; onboarding: ResumeOnboardingPlan }> {
  const resumeText = extractedText.slice(0, RESUME_PROMPT_CHARS);
  const raw = await generateJson<unknown>({
    model: RESUME_GEMINI_MODEL,
    maxOutputTokens: 10_240,
    temperature: 0.2,
    systemInstruction: buildCombinedResumeSystemInstruction(),
    userPrompt: buildCombinedResumeUserPrompt({
      targetRole: resolvePromptTargetRole(targetRole),
      resumeText,
    }),
  });

  const payload =
    raw && typeof raw === 'object'
      ? (raw as { analysis?: unknown; onboarding?: unknown })
      : {};

  const atsValidated = resumeReviewSchema.safeParse(
    normalizeRawResumeReview(payload.analysis, targetRole),
  );
  if (!atsValidated.success) {
    throw new AppError(
      502,
      `Invalid combined resume analysis from Gemini: ${atsValidated.error.message}`,
    );
  }

  const onboardingValidated = resumeOnboardingPlanSchema.safeParse(
    normalizeRawOnboarding(payload.onboarding),
  );
  if (!onboardingValidated.success) {
    throw new AppError(
      502,
      `Invalid combined onboarding plan from Gemini: ${onboardingValidated.error.message}`,
    );
  }

  return {
    ats: buildResumeAnalysisFromReview(atsValidated.data, extractedText),
    onboarding: {
      ...onboardingValidated.data,
      generatedAt: new Date().toISOString(),
    },
  };
}

async function runOnboardingPlanGeneration(
  extractedText: string,
  targetRole: string | undefined,
  analysis: ResumeAnalysis,
): Promise<ResumeOnboardingPlan> {
  const { extractedText: _omit, ...analysisSummary } = analysis;

  const raw = await generateJson<unknown>({
    model: RESUME_GEMINI_MODEL,
    systemInstruction: buildResumeOnboardingSystemInstruction(),
    userPrompt: buildResumeOnboardingUserPrompt({
      targetRole: resolvePromptTargetRole(targetRole),
      resumeText: extractedText.slice(0, RESUME_PROMPT_CHARS),
      analysis: analysisSummary,
    }),
    temperature: 0.25,
    maxOutputTokens: 10_240,
  });

  const validated = resumeOnboardingPlanSchema.safeParse(
    normalizeRawOnboarding(raw),
  );
  if (!validated.success) {
    throw new AppError(
      502,
      `Invalid resume onboarding plan from Gemini: ${validated.error.message}`,
    );
  }

  return {
    ...validated.data,
    generatedAt: new Date().toISOString(),
  };
}

function preferExistingText(
  existing: string | undefined,
  incoming: string | undefined,
): string | undefined {
  const current = existing?.trim();
  if (current) return current;
  const next = incoming?.trim();
  return next || undefined;
}

function mergeStringArrays(
  existing: string[] | undefined,
  incoming: string[] | undefined,
  limit?: number,
): string[] | undefined {
  const merged = [
    ...(existing ?? []),
    ...(incoming ?? []).filter(
      (item) =>
        item.trim() &&
        !(existing ?? []).some((e) => e.toLowerCase() === item.toLowerCase()),
    ),
  ];
  if (merged.length === 0) return existing;
  return typeof limit === 'number' ? merged.slice(0, limit) : merged;
}

function parseYearsExperience(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = raw.match(/(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function normalizeSingleRole(raw: string | undefined, fallback = 'Professional'): string {
  const value = raw?.trim();
  if (!value) return fallback;
  const first = value
    .split(/\s*(?:,|\/|\||\band\b|\bor\b)\s*/i)
    .map((part) => part.trim())
    .find(Boolean);
  return first || fallback;
}

/**
 * Merge onboarding plan into users/{uid}.onboarding and profile fields
 * without overwriting values the user already set.
 */
export async function mergeUserOnboardingFromPlan(
  uid: string,
  plan: ResumeOnboardingPlanParsed & { generatedAt: string },
  isCoder: boolean,
  targetRole?: string,
): Promise<void> {
  const db = ensureAdmin();
  const ref = userRef(db, uid);
  const snap = await ref.get();
  if (!snap.exists) return;

  const user = snap.data()!;
  const existingOnboarding = (user as { onboarding?: UserOnboardingSnapshot })
    .onboarding;
  const existingProfile = user.profile;

  const companyNames = plan.recommendedCompanies.map((c) => c.name);
  const weakSkills = plan.skillGapAnalysis
    .filter((s) => s.priority === 'High')
    .map((s) => s.name);
  const primarySkills = plan.careerPath
    .filter((t) => t.priority === 'High')
    .slice(0, 8)
    .map((t) => t.title);

  const nextOnboarding: UserOnboardingSnapshot = {
    selectedRole: preferExistingText(
      existingOnboarding?.selectedRole,
      normalizeSingleRole(plan.jobRoleRecommendation || targetRole, ''),
    ),
    experience: preferExistingText(
      existingOnboarding?.experience,
      plan.experienceLevelPrediction,
    ),
    primarySkills: mergeStringArrays(
      existingOnboarding?.primarySkills,
      primarySkills,
      12,
    ),
    careerGoal: preferExistingText(
      existingOnboarding?.careerGoal,
      `Prepare for ${normalizeSingleRole(plan.jobRoleRecommendation || targetRole)} interviews`,
    ),
    preparationRoadmap:
      existingOnboarding?.preparationRoadmap &&
      existingOnboarding.preparationRoadmap.length > 0
        ? existingOnboarding.preparationRoadmap
        : plan.learningRoadmap,
    recommendedInterviewTrack: preferExistingText(
      existingOnboarding?.recommendedInterviewTrack,
      plan.recommendedInterviewTracks[0],
    ),
    recommendedInterviewTracks: mergeStringArrays(
      (existingOnboarding as { recommendedInterviewTracks?: string[] } | undefined)
        ?.recommendedInterviewTracks,
      plan.recommendedInterviewTracks,
      10,
    ),
    weakSkills: mergeStringArrays(existingOnboarding?.weakSkills, weakSkills, 15),
    targetCompanies: mergeStringArrays(
      existingOnboarding?.targetCompanies,
      companyNames,
      10,
    ),
    estimatedPreparationTime: preferExistingText(
      existingOnboarding?.estimatedPreparationTime,
      `${plan.estimatedPreparationWeeks} weeks`,
    ),
    roadmapProgress:
      typeof existingOnboarding?.roadmapProgress === 'number'
        ? existingOnboarding.roadmapProgress
        : 0,
    suggestedFirstMockInterview: preferExistingText(
      existingOnboarding?.suggestedFirstMockInterview,
      plan.learningRoadmap[0]?.mockInterview,
    ),
    learningPriorities: mergeStringArrays(
      existingOnboarding?.learningPriorities,
      plan.priorityPreparationAreas,
      10,
    ),
    recommendedLearningTechnologies:
      existingOnboarding?.recommendedLearningTechnologies &&
      existingOnboarding.recommendedLearningTechnologies.length > 0
        ? existingOnboarding.recommendedLearningTechnologies
        : plan.recommendedLearningTechnologies,
    updatedAt: new Date().toISOString(),
  };

  const profileUpdates: Record<string, unknown> = {};
  const isDefaultRole =
    !existingProfile?.targetRole ||
    existingProfile.targetRole === 'Software Developer' ||
    existingProfile.targetRole === 'Software Engineer';

  if (isDefaultRole && (plan.jobRoleRecommendation || targetRole)) {
    profileUpdates['profile.targetRole'] =
      normalizeSingleRole(plan.jobRoleRecommendation || targetRole);
  }

  if (
    (!existingProfile?.currentRole ||
      existingProfile.currentRole === 'Software Developer') &&
    plan.jobRoleRecommendation
  ) {
    profileUpdates['profile.currentRole'] = normalizeSingleRole(plan.jobRoleRecommendation);
  }

  if (
    (!existingProfile?.targetCompanies ||
      existingProfile.targetCompanies.length === 0) &&
    companyNames.length > 0
  ) {
    profileUpdates['profile.targetCompanies'] = companyNames.slice(0, 10);
  }

  if (
    (!existingProfile?.yearsExperience || existingProfile.yearsExperience === 0) &&
    plan.experienceLevelPrediction
  ) {
    const years = parseYearsExperience(plan.experienceLevelPrediction);
    if (typeof years === 'number') {
      profileUpdates['profile.yearsExperience'] = years;
    }
  }

  await ref.set(
    {
      onboarding: nextOnboarding,
      resumeAnalysisCompleted: true,
      onboardingAnalysisCompleted: true,
      isCoder,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  if (Object.keys(profileUpdates).length > 0) {
    await ref.update({
      ...profileUpdates,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

/**
 * Flatten ATS analysis fields into Firestore dotted update paths.
 * Intentionally omits `analysis.onboarding` so re-analyze never touches it.
 */
function toAtsAnalysisFieldUpdates(
  ats: ResumeAnalysis,
): Record<string, unknown> {
  return {
    'analysis.isCoder': ats.isCoder ?? false,
    // Legacy (derived) fields
    'analysis.overallScore': ats.overallScore,
    'analysis.atsScore': ats.atsScore,
    'analysis.impactScore': ats.impactScore,
    'analysis.clarityScore': ats.clarityScore,
    'analysis.keywordMatch': ats.keywordMatch,
    'analysis.quantifiedImpact': ats.quantifiedImpact,
    'analysis.actionVerbs': ats.actionVerbs,
    'analysis.structureLength': ats.structureLength,
    'analysis.percentileVsPeers': ats.percentileVsPeers,
    'analysis.fixesFirst': ats.fixesFirst,
    'analysis.workingWell': ats.workingWell,
    'analysis.extractedKeywords': ats.extractedKeywords,
    'analysis.missingKeywords': ats.missingKeywords,
    'analysis.recommendedSkills': ats.recommendedSkills,
    'analysis.recommendedInterviewIds': ats.recommendedInterviewIds,
    ...(ats.extractedText !== undefined
      ? { 'analysis.extractedText': ats.extractedText }
      : {}),

    // Rich results-page fields
    'analysis.scores': ats.scores,
    'analysis.atsFriendly': ats.atsFriendly,
    ...(ats.scoreLabels !== undefined ? { 'analysis.scoreLabels': ats.scoreLabels } : {}),
    'analysis.strengths': ats.strengths,
    'analysis.areasToImprove': ats.areasToImprove,
    'analysis.suggestions': ats.suggestions,
    'analysis.aiFeedback': ats.aiFeedback,
    'analysis.sections': ats.sections,
    'analysis.keywords': ats.keywords,
    'analysis.ats': ats.ats,
    'analysis.roleMatches': ats.roleMatches,
    'analysis.detailedMetrics': ats.detailedMetrics,
  };
}

/** "PDF" | "DOCX" from the uploaded file name — only PDF is accepted today. */
function deriveFileType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toUpperCase();
  return ext === 'DOCX' || ext === 'DOC' ? 'DOCX' : 'PDF';
}

function timestampToIso(value: unknown, fallback: string): string {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    return (value as Timestamp).toDate().toISOString();
  }
  return fallback;
}

/**
 * Loads the canonical onboarding analysis doc at users/{uid}/onboarding/analysis.
 */
export async function loadOnboardingAnalysisDoc(uid: string) {
  const db = ensureAdmin();
  const ref = onboardingAnalysisRef(db, uid);
  const snap = await ref.get();
  return { ref, snap };
}

/**
 * Multipart PDF resume analysis: ATS scorecard only (PDF is not stored).
 * Upserts users/{uid}/onboarding/analysis — re-analyze updates ATS scores only.
 *
 * Onboarding is write-once:
 * - First analyze with onboarding=true → save analysis.onboarding
 * - Any later resume analyze → ATS updates via dotted paths; analysis.onboarding
 *   is never overwritten, regenerated, or removed
 */
export async function analyzeResume(
  uid: string,
  input: AnalyzeResumeInput,
): Promise<AnalyzeResumeApiResult> {
  if (!input.fileBuffer?.length) {
    throw new AppError(400, 'Resume PDF file is required.');
  }

  const db = ensureAdmin();
  const { snap: existing, ref } = await loadOnboardingAnalysisDoc(uid);

  const { text: extractedText } = await extractPdfText(input.fileBuffer);

  // Block wrong-person resumes before storage upload / AI analysis / Firestore writes.
  await assertResumeBelongsToUser(uid, extractedText);

  const storagePath = await uploadUserResumeFile(uid, input.fileBuffer, 'resume').catch(
    (err: unknown) => {
      logger.warn('[resume.service] resume storage upload failed — continuing without storagePath', {
        uid,
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    },
  );

  const existingOnboarding = existing.exists
    ? existing.data()?.analysis?.onboarding
    : undefined;

  const shouldGenerateOnboarding =
    Boolean(input.onboarding) && !existingOnboarding;

  let atsAnalysis: ResumeAnalysis;
  let onboardingPlan: ResumeOnboardingPlan | null = null;

  if (shouldGenerateOnboarding) {
    try {
      const combined = await runCombinedResumeAnalysis(
        extractedText,
        input.targetRole,
      );
      atsAnalysis = combined.ats;
      onboardingPlan = combined.onboarding;
    } catch (combinedErr) {
      logger.warn('[resume.service] combined ATS+onboarding failed; using sequential fallback', {
        error:
          combinedErr instanceof Error ? combinedErr.message : String(combinedErr),
      });
      atsAnalysis = await runAtsAnalysis(extractedText, input.targetRole);
      onboardingPlan = await runOnboardingPlanGeneration(
        extractedText,
        input.targetRole,
        atsAnalysis,
      );
    }
  } else {
    atsAnalysis = await runAtsAnalysis(extractedText, input.targetRole);
  }

  const existingData = existing.exists ? existing.data() : undefined;
  const version = existing.exists ? ((existingData?.version ?? 0) as number) + 1 : 1;

  // Prefer explicit client role; otherwise use onboarding inference / existing doc.
  const storedTargetRole =
    normalizeSingleRole(input.targetRole, '') ||
    normalizeSingleRole(onboardingPlan?.jobRoleRecommendation, '') ||
    normalizeSingleRole(atsAnalysis.roleMatches?.[0]?.role, '') ||
    normalizeSingleRole(existingOnboarding?.jobRoleRecommendation, '') ||
    (existing.exists ? String(existingData?.targetRole ?? '').trim() : '') ||
    'Professional';

  const fileType = deriveFileType(input.fileName);

  // Stable per-user id, generated once and preserved across re-analyze.
  const resumeId = existingData?.resumeId?.trim() || `res_${randomUUID()}`;
  // Regenerated on every analyze call — identifies this specific run.
  const analysisId = `an_${randomUUID()}`;
  const nowIso = new Date().toISOString();

  const meta = {
    resumeId,
    analysisId,
    fileName: input.fileName,
    fileType,
    version,
    isActive: true as const,
    uploadedAt: FieldValue.serverTimestamp() as never,
    lastAnalyzedAt: FieldValue.serverTimestamp() as never,
    targetRole: storedTargetRole,
    experienceLevel: atsAnalysis.experienceLevel,
    aiReviewedAt: FieldValue.serverTimestamp() as never,
    analysisStatus: 'completed' as const,
    ...(storagePath ? { storagePath } : {}),
  };

  const sourceMeta = { source: 'resume' as const };

  if (existing.exists) {
    // Dotted ATS updates leave analysis.onboarding untouched in Firestore
    const updates: Record<string, unknown> = {
      ...meta,
      ...sourceMeta,
      ...toAtsAnalysisFieldUpdates(atsAnalysis),
    };

    // First-time onboarding only — never replace an existing plan
    if (onboardingPlan) {
      updates['analysis.onboarding'] = onboardingPlan;
    }

    await ref.update(updates);
  } else {
    const analysis: ResumeAnalysis = {
      ...atsAnalysis,
      ...(onboardingPlan ? { onboarding: onboardingPlan } : {}),
    };
    await ref.set(
      { ...meta, ...sourceMeta, analysis } satisfies ResumeDoc,
      { merge: true },
    );
  }

  // Seed users/{uid}.onboarding in background — analysis doc is source of truth for API response.
  const userPersist = onboardingPlan
    ? mergeUserOnboardingFromPlan(
        uid,
        onboardingPlan,
        Boolean(atsAnalysis.isCoder),
        storedTargetRole,
      )
    : userRef(db, uid).set(
        {
          resumeAnalysisCompleted: true,
          onboardingAnalysisCompleted: true,
          isCoder: Boolean(atsAnalysis.isCoder),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

  void userPersist.catch((err: unknown) => {
    logger.error('[resume.service] background user persist failed', {
      uid,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  const analysis: ResumeAnalysis = {
    ...atsAnalysis,
    ...(existingOnboarding
      ? { onboarding: existingOnboarding }
      : onboardingPlan
        ? { onboarding: onboardingPlan }
        : {}),
  };

  const uploadedAtIso = existing.exists
    ? timestampToIso(existingData?.uploadedAt, nowIso)
    : nowIso;

  return {
    isCoder: atsAnalysis.isCoder,
    // New results-page contract
    resumeId,
    analysisId,
    fileName: input.fileName,
    fileType,
    storagePath: storagePath ?? existingData?.storagePath ?? '',
    analysisStatus: 'completed',
    uploadedAt: uploadedAtIso,
    lastAnalyzedAt: nowIso,
    targetRole: storedTargetRole,
    experienceLevel: meta.experienceLevel,
    scores: atsAnalysis.scores,
    atsFriendly: atsAnalysis.atsFriendly,
    scoreLabels: atsAnalysis.scoreLabels,
    strengths: atsAnalysis.strengths,
    areasToImprove: atsAnalysis.areasToImprove,
    suggestions: atsAnalysis.suggestions,
    aiFeedback: atsAnalysis.aiFeedback,
    sections: atsAnalysis.sections,
    keywords: atsAnalysis.keywords,
    ats: atsAnalysis.ats,
    roleMatches: atsAnalysis.roleMatches,
    detailedMetrics: atsAnalysis.detailedMetrics,
    extractedText: atsAnalysis.extractedText,

    // Back-compat extras (onboarding wizard + current Angular results page)
    analysis,
    onboardingGenerated: Boolean(onboardingPlan),
    onboardingPreserved: Boolean(existingOnboarding),
  };
}

