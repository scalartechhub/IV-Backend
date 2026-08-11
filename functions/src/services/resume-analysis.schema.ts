/**
 * Zod schema + Gemini-drift normalizers for the rich resume-review analysis
 * (results-page contract). Mirrors the resume-onboarding.schema.ts pattern.
 */

import { z } from 'zod';

const scoreWithDeltaSchema = z.object({ score: z.number(), delta: z.number() });

const scoreBlockSchema = z.object({
  overall: z.number(),
  overallMessage: z.string().optional(),
  impact: z.number(),
  content: z.number(),
  structure: z.number(),
  ats: z.number(),
  relevance: z.number(),
  peerPercentile: z.number().optional(),
});

const scoreLabelsSchema = z.object({
  impact: z.string().optional(),
  content: z.string().optional(),
  structure: z.string().optional(),
  ats: z.string().optional(),
  relevance: z.string().optional(),
});

const listItemSchema = z.object({ id: z.string().min(1), text: z.string().min(1) });

const suggestionItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  severity: z.enum(['high', 'medium', 'low']),
  type: z.enum(['critical', 'warning', 'info']).optional(),
  priority: z.number(),
});

const aiFeedbackSchema = z.object({
  overallFeedback: z.string().min(1),
  recruiterComment: z.string().min(1),
});

const sectionItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  score: z.number(),
  feedback: z.string().min(1),
  looksGood: z.boolean(),
});

const keywordItemSchema = z.object({ keyword: z.string().min(1) });

const keywordDensityItemSchema = z.object({
  label: z.string().min(1),
  percent: z.number(),
  tone: z.enum(['success', 'warning', 'danger']),
});

const keywordsBlockSchema = z.object({
  matchScore: z.number(),
  matchLabel: z.string().optional(),
  matchHint: z.string().optional(),
  totalKeywords: z.number(),
  matchedCount: z.number(),
  matchedPercent: z.number(),
  missingCount: z.number(),
  missingPercent: z.number(),
  matched: z.array(keywordItemSchema),
  missing: z.array(keywordItemSchema),
  density: z.array(keywordDensityItemSchema),
  recommendations: z.array(z.string()).optional(),
});

const atsCheckResultSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(['good', 'minor', 'neutral']),
  statusLabel: z.string().min(1),
});

const atsRecommendationSchema = z.object({
  text: z.string().min(1),
  reason: z.string().min(1),
});

const atsBlockSchema = z.object({
  compatibilityScore: z.number(),
  compatibilityLabel: z.string().optional(),
  compatibilityHint: z.string().optional(),
  checkResults: z.array(atsCheckResultSchema),
  previewSnippet: z.string(),
  parseScore: z.number(),
  recommendations: z.array(atsRecommendationSchema),
});

const roleMatchSchema = z.object({
  role: z.string().min(1),
  score: z.number(),
  label: z.string().min(1),
  feedback: z.string().min(1),
});

const detailedMetricsSchema = z.object({
  keywordMatch: scoreWithDeltaSchema,
  quantifiedImpact: scoreWithDeltaSchema,
  actionVerbs: scoreWithDeltaSchema,
  structureLength: scoreWithDeltaSchema,
});

export const resumeReviewSchema = z.object({
  isCoder: z.boolean().optional(),
  experienceLevel: z.string().min(1),
  scores: scoreBlockSchema,
  scoreLabels: scoreLabelsSchema.optional(),
  strengths: z.array(listItemSchema).min(3),
  areasToImprove: z.array(listItemSchema).min(3),
  suggestions: z.array(suggestionItemSchema).min(3),
  aiFeedback: aiFeedbackSchema,
  sections: z.array(sectionItemSchema).min(5),
  keywords: keywordsBlockSchema,
  ats: atsBlockSchema,
  roleMatches: z.array(roleMatchSchema).min(1),
  detailedMetrics: detailedMetricsSchema,
  recommendedSkills: z.array(z.string()).default([]),
  recommendedInterviewIds: z.array(z.string()).default([]),
});

export type ResumeReviewParsed = z.infer<typeof resumeReviewSchema>;

function inferIsCoder(targetRole: string, rawRoleMatches: unknown, rawRecommendedSkills: unknown): boolean {
  const codingKeywords = [
    'software',
    'developer',
    'engineer',
    'frontend',
    'backend',
    'full stack',
    'full-stack',
    'web',
    'mobile',
    'react',
    'angular',
    'vue',
    'node',
    'java',
    'python',
    'javascript',
    'typescript',
    'c++',
    'c#',
    'golang',
    'devops',
    'data',
    'ml',
    'ai',
    'cloud',
    'sde',
  ];
  const nonCodingKeywords = [
    'hr',
    'human resources',
    'sales',
    'marketing',
    'finance',
    'account',
    'accountant',
    'recruiter',
    'operations',
    'business development',
  ];
  const roleTexts = Array.isArray(rawRoleMatches)
    ? rawRoleMatches
        .map((item) => {
          const obj = (item ?? {}) as Record<string, unknown>;
          return String(obj.role ?? '').toLowerCase();
        })
        .filter(Boolean)
    : [];
  const skillTexts = asStringArray(rawRecommendedSkills).map((s) => s.toLowerCase());
  const bag = [targetRole.toLowerCase(), ...roleTexts, ...skillTexts].join(' ');
  const hasNonCoding = nonCodingKeywords.some((k) => bag.includes(k));
  const hasCoding = codingKeywords.some((k) => bag.includes(k));
  if (hasCoding) return true;
  if (hasNonCoding) return false;
  return false;
}

/** Fixed section ids Gemini is asked to always return, in this order. */
export const RESUME_SECTION_IDS = [
  'contact',
  'summary',
  'experience',
  'skills',
  'projects',
  'education',
  'certifications',
  'achievements',
  'additional',
] as const;

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && 'keyword' in item) {
        return String((item as { keyword: unknown }).keyword ?? '').trim();
      }
      if (item && typeof item === 'object' && 'text' in item) {
        return String((item as { text: unknown }).text ?? '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

function normalizeListItems(raw: unknown, idPrefix: string): Array<{ id: string; text: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    if (typeof item === 'string') {
      return { id: `${idPrefix}-${index + 1}`, text: item.trim() };
    }
    const obj = (item ?? {}) as { id?: unknown; text?: unknown };
    return {
      id: typeof obj.id === 'string' && obj.id.trim() ? obj.id : `${idPrefix}-${index + 1}`,
      text: String(obj.text ?? '').trim() || 'No detail provided',
    };
  });
}

function clampScore(n: unknown, fallback = 0): number {
  const value = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function limitWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return words.slice(0, maxWords).join(' ');
}

function toSingleWordCapsule(text: string): string {
  const first = text.trim().split(/\s+/).find(Boolean) ?? '';
  return first.replace(/^[^A-Za-z0-9+#./-]+|[^A-Za-z0-9+#./-]+$/g, '');
}

function normalizeScoreWithDelta(raw: unknown): { score: number; delta: number } {
  if (typeof raw === 'number') return { score: clampScore(raw), delta: 0 };
  if (raw && typeof raw === 'object') {
    const obj = raw as { score?: unknown; delta?: unknown };
    return {
      score: clampScore(obj.score),
      delta: typeof obj.delta === 'number' ? obj.delta : 0,
    };
  }
  return { score: 0, delta: 0 };
}

function normalizeSuggestions(raw: unknown): Array<{
  id: string;
  text: string;
  severity: 'high' | 'medium' | 'low';
  type?: 'critical' | 'warning' | 'info';
  priority: number;
}> {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const severity =
      obj.severity === 'high' || obj.severity === 'medium' || obj.severity === 'low'
        ? obj.severity
        : 'medium';
    const type =
      obj.type === 'critical' || obj.type === 'warning' || obj.type === 'info'
        ? obj.type
        : severity === 'high'
          ? 'critical'
          : severity === 'medium'
            ? 'warning'
            : 'info';
    return {
      id: typeof obj.id === 'string' && obj.id.trim() ? obj.id : `sugg-${index + 1}`,
      text: String(obj.text ?? '').trim() || 'Improve this section',
      severity,
      type,
      priority: typeof obj.priority === 'number' ? obj.priority : index + 1,
    };
  });
}

function normalizeSections(raw: unknown): Array<{
  id: string;
  label: string;
  score: number;
  feedback: string;
  looksGood: boolean;
}> {
  const bySectionId = new Map<string, Record<string, unknown>>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const obj = (item ?? {}) as Record<string, unknown>;
      const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : '';
      if (id) bySectionId.set(id, obj);
    }
  }

  const defaultLabels: Record<string, string> = {
    contact: 'Contact Information',
    summary: 'Professional Summary',
    experience: 'Work Experience',
    skills: 'Skills',
    projects: 'Projects',
    education: 'Education',
    certifications: 'Certifications',
    achievements: 'Achievements',
    additional: 'Additional Information',
  };

  return RESUME_SECTION_IDS.map((id) => {
    const obj = bySectionId.get(id) ?? {};
    return {
      id,
      label: String(obj.label ?? defaultLabels[id] ?? id).trim(),
      score: clampScore(obj.score, 60),
      feedback: String(obj.feedback ?? `${defaultLabels[id]} could not be evaluated.`).trim(),
      looksGood: typeof obj.looksGood === 'boolean' ? obj.looksGood : clampScore(obj.score, 60) >= 70,
    };
  });
}

function normalizeKeywordItems(raw: unknown): Array<{ keyword: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      const obj = (item ?? {}) as { keyword?: unknown };
      return String(obj.keyword ?? '').trim();
    })
    .filter(Boolean)
    .map((keyword) => ({ keyword }));
}

function normalizeDensity(raw: unknown): Array<{ label: string; percent: number; tone: 'success' | 'warning' | 'danger' }> {
  const fallback = [
    { label: 'Optimal', percent: 60, tone: 'success' as const },
    { label: 'Too Low', percent: 30, tone: 'warning' as const },
    { label: 'Too High', percent: 10, tone: 'danger' as const },
  ];
  if (!Array.isArray(raw) || raw.length === 0) return fallback;
  return raw.map((item, index) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const tone =
      obj.tone === 'success' || obj.tone === 'warning' || obj.tone === 'danger'
        ? obj.tone
        : (fallback[index]?.tone ?? 'warning');
    return {
      label: String(obj.label ?? fallback[index]?.label ?? 'Other').trim(),
      percent: clampScore(obj.percent, fallback[index]?.percent ?? 0),
      tone,
    };
  });
}

function normalizeKeywords(raw: unknown): Record<string, unknown> {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const matched = normalizeKeywordItems(obj.matched);
  const missing = normalizeKeywordItems(obj.missing);
  const totalKeywords =
    typeof obj.totalKeywords === 'number' ? obj.totalKeywords : matched.length + missing.length;
  const matchedCount = typeof obj.matchedCount === 'number' ? obj.matchedCount : matched.length;
  const missingCount = typeof obj.missingCount === 'number' ? obj.missingCount : missing.length;
  const total = Math.max(1, totalKeywords);

  return {
    matchScore: clampScore(obj.matchScore),
    ...(typeof obj.matchLabel === 'string' && obj.matchLabel.trim()
      ? { matchLabel: obj.matchLabel.trim() }
      : {}),
    ...(typeof obj.matchHint === 'string' && obj.matchHint.trim()
      ? { matchHint: limitWords(obj.matchHint.trim(), 2) }
      : {}),
    totalKeywords,
    matchedCount,
    matchedPercent:
      typeof obj.matchedPercent === 'number'
        ? clampScore(obj.matchedPercent)
        : clampScore(Math.round((matchedCount / total) * 100)),
    missingCount,
    missingPercent:
      typeof obj.missingPercent === 'number'
        ? clampScore(obj.missingPercent)
        : clampScore(Math.round((missingCount / total) * 100)),
    matched,
    missing,
    density: normalizeDensity(obj.density),
    recommendations: asStringArray(obj.recommendations ?? missing)
      .map(toSingleWordCapsule)
      .filter(Boolean),
  };
}

function normalizeAtsCheckResults(raw: unknown): Array<{
  id: string;
  label: string;
  status: 'good' | 'minor' | 'neutral';
  statusLabel: string;
}> {
  const statusLabels: Record<string, string> = { good: 'Good', minor: 'Minor Issues', neutral: 'Not Detected' };
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const status =
      obj.status === 'good' || obj.status === 'minor' || obj.status === 'neutral'
        ? obj.status
        : 'neutral';
    return {
      id: typeof obj.id === 'string' && obj.id.trim() ? obj.id : `check-${index + 1}`,
      label: String(obj.label ?? `Check ${index + 1}`).trim(),
      status,
      statusLabel: String(obj.statusLabel ?? statusLabels[status]).trim(),
    };
  });
}

function normalizeAtsRecommendations(raw: unknown): Array<{ text: string; reason: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (typeof item === 'string') return { text: item.trim(), reason: 'Improves ATS compatibility' };
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      text: String(obj.text ?? '').trim() || 'Simplify formatting',
      reason: String(obj.reason ?? 'Improves ATS compatibility').trim(),
    };
  });
}

function normalizeAts(raw: unknown, atsScore: number): Record<string, unknown> {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    compatibilityScore:
      typeof obj.compatibilityScore === 'number' ? clampScore(obj.compatibilityScore) : atsScore,
    ...(typeof obj.compatibilityLabel === 'string' && obj.compatibilityLabel.trim()
      ? { compatibilityLabel: obj.compatibilityLabel.trim() }
      : {}),
    ...(typeof obj.compatibilityHint === 'string' && obj.compatibilityHint.trim()
      ? { compatibilityHint: obj.compatibilityHint.trim() }
      : {}),
    checkResults: normalizeAtsCheckResults(obj.checkResults),
    previewSnippet: String(obj.previewSnippet ?? '').trim(),
    parseScore: clampScore(obj.parseScore, atsScore),
    recommendations: normalizeAtsRecommendations(obj.recommendations),
  };
}

function normalizeRoleMatches(raw: unknown, targetRole: string): Array<{
  role: string;
  score: number;
  label: string;
  feedback: string;
}> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      {
        role: targetRole || 'Target Role',
        score: 60,
        label: 'Good Match',
        feedback: 'Relevant fit with gaps',
      },
    ];
  }
  return raw.map((item, index) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      role: String(obj.role ?? (index === 0 ? targetRole : `Related Role ${index + 1}`)).trim(),
      score: clampScore(obj.score, 60),
      label: String(obj.label ?? 'Good Match').trim(),
      feedback: limitWords(String(obj.feedback ?? 'Reasonable role alignment').trim(), 5),
    };
  });
}

function normalizeScoreBlock(raw: unknown): Record<string, unknown> {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    overall: clampScore(obj.overall),
    ...(typeof obj.overallMessage === 'string' && obj.overallMessage.trim()
      ? { overallMessage: limitWords(obj.overallMessage.trim(), 4) }
      : {}),
    impact: clampScore(obj.impact),
    content: clampScore(obj.content),
    structure: clampScore(obj.structure),
    ats: clampScore(obj.ats),
    relevance: clampScore(obj.relevance),
    ...(typeof obj.peerPercentile === 'number' ? { peerPercentile: clampScore(obj.peerPercentile) } : {}),
  };
}

function normalizeScoreLabels(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ['impact', 'content', 'structure', 'ats', 'relevance']) {
    if (typeof obj[key] === 'string' && (obj[key] as string).trim()) {
      result[key] = (obj[key] as string).trim();
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeDetailedMetrics(raw: unknown): Record<string, unknown> {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    keywordMatch: normalizeScoreWithDelta(obj.keywordMatch),
    quantifiedImpact: normalizeScoreWithDelta(obj.quantifiedImpact),
    actionVerbs: normalizeScoreWithDelta(obj.actionVerbs),
    structureLength: normalizeScoreWithDelta(obj.structureLength),
  };
}

/** Coerce common Gemini shape drift before zod validation. */
export function normalizeRawResumeReview(raw: unknown, targetRole?: string): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const data = raw as Record<string, unknown>;
  const scores = normalizeScoreBlock(data.scores);
  const ats = normalizeAts(data.ats, (scores as { ats: number }).ats);
  const scoreLabels = normalizeScoreLabels(data.scoreLabels);
  const inferredIsCoder = inferIsCoder(
    targetRole ?? '',
    data.roleMatches,
    data.recommendedSkills,
  );

  return {
    isCoder: typeof data.isCoder === 'boolean' ? data.isCoder : inferredIsCoder,
    experienceLevel: String(data.experienceLevel ?? 'Mid-Level').trim() || 'Mid-Level',
    scores,
    ...(scoreLabels ? { scoreLabels } : {}),
    strengths: normalizeListItems(data.strengths, 'strength'),
    areasToImprove: normalizeListItems(data.areasToImprove, 'improve'),
    suggestions: normalizeSuggestions(data.suggestions),
    aiFeedback: {
      overallFeedback:
        String((data.aiFeedback as Record<string, unknown> | undefined)?.overallFeedback ?? '').trim() ||
        'Your resume shows relevant experience for this role with room for improvement.',
      recruiterComment:
        String((data.aiFeedback as Record<string, unknown> | undefined)?.recruiterComment ?? '').trim() ||
        'A recruiter would find this resume reasonably clear on first pass.',
    },
    sections: normalizeSections(data.sections),
    keywords: normalizeKeywords(data.keywords),
    ats,
    roleMatches: normalizeRoleMatches(data.roleMatches, targetRole ?? ''),
    detailedMetrics: normalizeDetailedMetrics(data.detailedMetrics),
    recommendedSkills: asStringArray(data.recommendedSkills),
    recommendedInterviewIds: asStringArray(data.recommendedInterviewIds),
  };
}
