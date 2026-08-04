/**
 * Q&A onboarding analysis — generates the same interview-prep plan as resume
 * onboarding, grounded in wizard answers instead of a PDF.
 * Writes users/{uid}/onboarding/analysis with source: 'questions'.
 */

import { FieldValue } from 'firebase-admin/firestore';
import type {
  ResumeAnalysis,
  ResumeDoc,
  ResumeOnboardingPlan,
} from '../interfaces/resume.interface';
import { generateJson, RESUME_GEMINI_MODEL } from '../library/gemini-client';
import {
  buildQaOnboardingSystemInstruction,
  buildQaOnboardingUserPrompt,
  type QaOnboardingAnswers,
} from '../modules/interview/prompts/qa-onboarding.prompt';
import { AppError } from '../shared/utils';
import { logger } from '../shared/logger';
import { ensureAdmin } from '../utils/callable-auth';
import { onboardingAnalysisRef } from '../utils/firestore-refs';
import { resumeOnboardingPlanSchema } from './resume-onboarding.schema';
import {
  loadOnboardingAnalysisDoc,
  mergeUserOnboardingFromPlan,
  normalizeRawOnboarding,
} from './resume.service';

export type AnalyzeFromAnswersInput = QaOnboardingAnswers;

const EMPTY_ATS: Omit<ResumeAnalysis, 'onboarding' | 'extractedText'> = {
  overallScore: 0,
  atsScore: 0,
  impactScore: 0,
  clarityScore: 0,
  keywordMatch: { score: 0, delta: 0 },
  quantifiedImpact: { score: 0, delta: 0 },
  actionVerbs: { score: 0, delta: 0 },
  structureLength: { score: 0, delta: 0 },
  percentileVsPeers: 0,
  fixesFirst: [],
  workingWell: [],
  extractedKeywords: [],
  missingKeywords: [],
  recommendedSkills: [],
  recommendedInterviewIds: [],
};

async function runQaOnboardingPlanGeneration(
  answers: AnalyzeFromAnswersInput,
): Promise<ResumeOnboardingPlan> {
  const raw = await generateJson<unknown>({
    model: RESUME_GEMINI_MODEL,
    systemInstruction: buildQaOnboardingSystemInstruction(),
    userPrompt: buildQaOnboardingUserPrompt(answers),
    temperature: 0.25,
    maxOutputTokens: 10_240,
  });

  const validated = resumeOnboardingPlanSchema.safeParse(
    normalizeRawOnboarding(raw),
  );
  if (!validated.success) {
    throw new AppError(
      502,
      `Invalid Q&A onboarding plan from Gemini: ${validated.error.message}`,
    );
  }

  return {
    ...validated.data,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate (or preserve) onboarding plan from questionnaire answers.
 * Write-once: if analysis.onboarding already exists, return it without regenerating.
 */
export async function analyzeFromAnswers(
  uid: string,
  answers: AnalyzeFromAnswersInput,
) {
  if (!answers.roleId?.trim() || !answers.roleLabel?.trim()) {
    throw new AppError(400, 'roleId and roleLabel are required.');
  }
  if (!answers.domainId?.trim()) {
    throw new AppError(400, 'domainId is required.');
  }
  if (!answers.experienceBucketId?.trim()) {
    throw new AppError(400, 'experienceBucketId is required.');
  }
  if (!answers.journeyStageId?.trim()) {
    throw new AppError(400, 'journeyStageId is required.');
  }

  const db = ensureAdmin();
  const { snap: existing } = await loadOnboardingAnalysisDoc(uid);
  const ref = onboardingAnalysisRef(db, uid);

  const existingOnboarding = existing.exists
    ? existing.data()?.analysis?.onboarding
    : undefined;

  if (existingOnboarding) {
    const prior = existing.data()!;
    return {
      analysisId: 'analysis',
      analysisStatus: 'completed' as const,
      analysis: {
        ...EMPTY_ATS,
        ...(prior.analysis ?? {}),
        onboarding: existingOnboarding,
      },
      targetRole: prior.targetRole || existingOnboarding.jobRoleRecommendation,
      source: (prior.source ?? 'questions') as 'resume' | 'questions',
      onboardingGenerated: false,
      onboardingPreserved: true,
    };
  }

  let onboardingPlan: ResumeOnboardingPlan;
  try {
    onboardingPlan = await runQaOnboardingPlanGeneration(answers);
  } catch (err) {
    logger.error('[onboarding.service] Q&A plan generation failed', {
      uid,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const storedTargetRole =
    onboardingPlan.jobRoleRecommendation?.trim() ||
    answers.roleLabel.trim() ||
    'Software Engineer';

  const version = existing.exists
    ? ((existing.data()?.version ?? 0) as number) + 1
    : 1;

  const analysis: ResumeAnalysis = {
    ...EMPTY_ATS,
    recommendedSkills: onboardingPlan.skillGapAnalysis
      .slice(0, 12)
      .map((s) => s.name),
    onboarding: onboardingPlan,
  };

  const doc: ResumeDoc = {
    fileName: 'questions',
    version,
    isActive: true,
    uploadedAt: FieldValue.serverTimestamp() as never,
    targetRole: storedTargetRole,
    analysis,
    aiReviewedAt: FieldValue.serverTimestamp() as never,
    analysisStatus: 'completed',
    source: 'questions',
  };

  await ref.set(doc, { merge: true });

  void mergeUserOnboardingFromPlan(uid, onboardingPlan, storedTargetRole).catch(
    (err: unknown) => {
      logger.error('[onboarding.service] background user persist failed', {
        uid,
        error: err instanceof Error ? err.message : String(err),
      });
    },
  );

  return {
    analysisId: 'analysis',
    analysisStatus: 'completed' as const,
    analysis,
    targetRole: storedTargetRole,
    source: 'questions' as const,
    onboardingGenerated: true,
    onboardingPreserved: false,
  };
}
