/**
 * V2 resume service — multipart PDF analyze + upsert.
 * When onboarding=true, also generates a full interview-prep onboarding plan.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import type {
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
import { AppError } from '../shared/utils';
import { logger } from '../shared/logger';
import { extractPdfText } from '../shared/utils/pdf';
import { ensureAdmin } from '../utils/callable-auth';
import {
  onboardingAnalysisRef,
  userRef,
} from '../utils/firestore-refs';
import {
  resumeOnboardingPlanSchema,
  type ResumeOnboardingPlanParsed,
} from './resume-onboarding.schema';

/** Resume text sent to Gemini — keeps prompts fast without losing signal. */
const RESUME_PROMPT_CHARS = 12_000;
/** Stored extracted text cap (smaller writes on re-analyze). */
const STORED_EXTRACTED_TEXT_CHARS = 20_000;

const analysisSchema = z.object({
  overallScore: z.number(),
  atsScore: z.number(),
  impactScore: z.number(),
  clarityScore: z.number(),
  keywordMatch: z.object({ score: z.number(), delta: z.number() }),
  quantifiedImpact: z.object({ score: z.number(), delta: z.number() }),
  actionVerbs: z.object({ score: z.number(), delta: z.number() }),
  structureLength: z.object({ score: z.number(), delta: z.number() }),
  percentileVsPeers: z.number(),
  fixesFirst: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(['high', 'medium', 'low']),
      text: z.string(),
    }),
  ),
  workingWell: z.array(z.object({ id: z.string(), text: z.string() })),
  extractedKeywords: z.array(z.string()),
  missingKeywords: z.array(z.string()),
  recommendedSkills: z.array(z.string()),
  recommendedInterviewIds: z.array(z.string()).default([]),
});

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

function normalizeFixesFirst(raw: unknown): Array<{
  id: string;
  severity: 'high' | 'medium' | 'low';
  text: string;
}> {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    if (typeof item === 'string') {
      return { id: `fix-${index + 1}`, severity: 'medium' as const, text: item.trim() };
    }
    const obj = (item ?? {}) as {
      id?: unknown;
      severity?: unknown;
      text?: unknown;
    };
    const severity =
      obj.severity === 'high' || obj.severity === 'medium' || obj.severity === 'low'
        ? obj.severity
        : 'medium';
    return {
      id: typeof obj.id === 'string' && obj.id.trim() ? obj.id : `fix-${index + 1}`,
      severity,
      text: String(obj.text ?? '').trim() || 'Improve this section',
    };
  });
}

function normalizeWorkingWell(
  raw: unknown,
): Array<{ id: string; text: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    if (typeof item === 'string') {
      return { id: `well-${index + 1}`, text: item.trim() };
    }
    const obj = (item ?? {}) as { id?: unknown; text?: unknown };
    return {
      id: typeof obj.id === 'string' && obj.id.trim() ? obj.id : `well-${index + 1}`,
      text: String(obj.text ?? '').trim() || 'Strong point',
    };
  });
}

function normalizeScoreWithDelta(raw: unknown): { score: number; delta: number } {
  if (typeof raw === 'number') return { score: raw, delta: 0 };
  if (raw && typeof raw === 'object') {
    const obj = raw as { score?: unknown; delta?: unknown };
    return {
      score: typeof obj.score === 'number' ? obj.score : 0,
      delta: typeof obj.delta === 'number' ? obj.delta : 0,
    };
  }
  return { score: 0, delta: 0 };
}

/** Coerce common Gemini shape drift before zod validation. */
function normalizeRawAnalysis(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const data = raw as Record<string, unknown>;
  return {
    ...data,
    keywordMatch: normalizeScoreWithDelta(data.keywordMatch),
    quantifiedImpact: normalizeScoreWithDelta(data.quantifiedImpact),
    actionVerbs: normalizeScoreWithDelta(data.actionVerbs),
    structureLength: normalizeScoreWithDelta(data.structureLength),
    fixesFirst: normalizeFixesFirst(data.fixesFirst ?? data.fixSuggestions),
    workingWell: normalizeWorkingWell(data.workingWell),
    extractedKeywords: asStringArray(data.extractedKeywords),
    missingKeywords: asStringArray(data.missingKeywords),
    recommendedSkills: asStringArray(data.recommendedSkills),
    recommendedInterviewIds: asStringArray(data.recommendedInterviewIds),
  };
}

const PRIORITIES = new Set(['High', 'Medium', 'Low']);
const SKILL_LEVELS = new Set(['Beginner', 'Intermediate', 'Advanced', 'Expert']);
const DIFFICULTIES = new Set(['Easy', 'Medium', 'Hard']);
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

function asDifficulty(raw: unknown, fallback: 'Easy' | 'Medium' | 'Hard' = 'Medium') {
  return typeof raw === 'string' && DIFFICULTIES.has(raw)
    ? (raw as 'Easy' | 'Medium' | 'Hard')
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
        return {
          name: String(obj.name ?? `Company ${index + 1}`).trim(),
          reason: String(obj.reason ?? 'Relevant to your resume skills').trim(),
          difficulty: asDifficulty(obj.difficulty),
          priority: typeof obj.priority === 'number' ? obj.priority : index + 1,
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

  return {
    careerPath: careerPath.slice(0, 30),
    recommendedCompanies: recommendedCompanies.slice(0, 10),
    skillGapAnalysis,
    learningRoadmap: learningRoadmap.slice(0, 8),
    interviewPreparation,
    recommendedInterviewTracks: asStringArray(data.recommendedInterviewTracks),
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
      data.jobRoleRecommendation ?? 'Software Engineer',
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

async function runAtsAnalysis(
  extractedText: string,
  targetRole?: string,
): Promise<ResumeAnalysis> {
  const resumeText = extractedText.slice(0, RESUME_PROMPT_CHARS);
  const rawAnalysis = await generateJson<unknown>({
    model: RESUME_GEMINI_MODEL,
    maxOutputTokens: 2048,
    temperature: 0.15,
    systemInstruction: `You are an ATS resume analyzer. Respond ONLY with valid JSON.
Required shape:
{
  "overallScore": number,
  "atsScore": number,
  "impactScore": number,
  "clarityScore": number,
  "keywordMatch": { "score": number, "delta": number },
  "quantifiedImpact": { "score": number, "delta": number },
  "actionVerbs": { "score": number, "delta": number },
  "structureLength": { "score": number, "delta": number },
  "percentileVsPeers": number,
  "fixesFirst": [ { "id": "fix-1", "severity": "high"|"medium"|"low", "text": string } ],
  "workingWell": [ { "id": "well-1", "text": string } ],
  "extractedKeywords": string[],
  "missingKeywords": string[],
  "recommendedSkills": string[],
  "recommendedInterviewIds": string[]
}
IMPORTANT: fixesFirst and workingWell MUST be arrays of exactly 3 objects, never plain strings.
When targetRole asks to infer from the resume, score against the primary role reflected in the resume.`,
    userPrompt: JSON.stringify({
      targetRole: resolvePromptTargetRole(targetRole),
      resumeText,
    }),
  });

  const validated = analysisSchema.safeParse(normalizeRawAnalysis(rawAnalysis));
  if (!validated.success) {
    throw new AppError(
      502,
      `Invalid resume analysis from Gemini: ${validated.error.message}`,
    );
  }

  return {
    ...validated.data,
    extractedText: extractedText.slice(0, STORED_EXTRACTED_TEXT_CHARS),
  };
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

  const atsValidated = analysisSchema.safeParse(
    normalizeRawAnalysis(payload.analysis),
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
    ats: {
      ...atsValidated.data,
      extractedText: extractedText.slice(0, STORED_EXTRACTED_TEXT_CHARS),
    },
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

/**
 * Merge onboarding plan into users/{uid}.onboarding and profile fields
 * without overwriting values the user already set.
 */
export async function mergeUserOnboardingFromPlan(
  uid: string,
  plan: ResumeOnboardingPlanParsed & { generatedAt: string },
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
      plan.jobRoleRecommendation || targetRole,
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
      `Prepare for ${plan.jobRoleRecommendation || targetRole} interviews`,
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
    updatedAt: new Date().toISOString(),
  };

  const profileUpdates: Record<string, unknown> = {};
  const isDefaultRole =
    !existingProfile?.targetRole ||
    existingProfile.targetRole === 'Software Developer' ||
    existingProfile.targetRole === 'Software Engineer';

  if (isDefaultRole && (plan.jobRoleRecommendation || targetRole)) {
    profileUpdates['profile.targetRole'] =
      plan.jobRoleRecommendation || targetRole;
  }

  if (
    (!existingProfile?.currentRole ||
      existingProfile.currentRole === 'Software Developer') &&
    plan.jobRoleRecommendation
  ) {
    profileUpdates['profile.currentRole'] = plan.jobRoleRecommendation;
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
  };
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
export async function analyzeResume(uid: string, input: AnalyzeResumeInput) {
  if (!input.fileBuffer?.length) {
    throw new AppError(400, 'Resume PDF file is required.');
  }

  const db = ensureAdmin();
  const { snap: existing, ref } = await loadOnboardingAnalysisDoc(uid);

  const { text: extractedText } = await extractPdfText(input.fileBuffer);

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

  const version = existing.exists
    ? ((existing.data()?.version ?? 0) as number) + 1
    : 1;

  // Prefer explicit client role; otherwise use onboarding inference / existing doc.
  const storedTargetRole =
    input.targetRole?.trim() ||
    onboardingPlan?.jobRoleRecommendation?.trim() ||
    existingOnboarding?.jobRoleRecommendation?.trim() ||
    (existing.exists ? String(existing.data()?.targetRole ?? '').trim() : '') ||
    'Software Engineer';

  const meta = {
    fileName: input.fileName,
    version,
    isActive: true as const,
    uploadedAt: FieldValue.serverTimestamp() as never,
    targetRole: storedTargetRole,
    aiReviewedAt: FieldValue.serverTimestamp() as never,
    analysisStatus: 'completed' as const,
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
    ? mergeUserOnboardingFromPlan(uid, onboardingPlan, storedTargetRole)
    : userRef(db, uid).set(
        {
          resumeAnalysisCompleted: true,
          onboardingAnalysisCompleted: true,
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

  return {
    resumeId: 'analysis',
    analysisStatus: 'completed' as const,
    analysis,
    targetRole: storedTargetRole,
    onboardingGenerated: Boolean(onboardingPlan),
    onboardingPreserved: Boolean(existingOnboarding),
  };
}

