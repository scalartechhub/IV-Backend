import { getGenAI, getActiveGeminiModel, GEMINI_REQUEST_TIMEOUT_MS } from '../config/gemini';
import { aiService } from '../modules/ai/ai.service';
import {
  buildJdAnalysisPrompt,
  buildJdOcrPrompt,
  type JdAnalysisOptionalContext,
  type JdAnalysisResult,
} from '../modules/interview/prompts/jd-analysis.prompt';
import type { InterviewDifficulty, InterviewMode } from '../interfaces/interview.interface';
import { logger } from '../shared/logger';
import { AppError } from '../shared/utils';

const MAX_JD_CHARS = 25_000;
const MIN_JD_CHARS = 30;
const MAX_IMAGE_BASE64_CHARS = 14_000_000; // ~10MB binary

const EXPERIENCE_LEVELS = new Set(['Entry', 'Mid', 'Senior', 'Lead', 'Executive']);
const INTERVIEW_MODES = new Set<InterviewMode>([
  'conversational',
  'coding',
  'behavioral',
  'system_design',
  'hr',
]);
const DIFFICULTIES = new Set<InterviewDifficulty>(['easy', 'medium', 'hard']);

function normalizeExperienceLevel(value: unknown): JdAnalysisResult['experienceLevel'] {
  const raw = String(value ?? 'Mid');
  if (EXPERIENCE_LEVELS.has(raw as JdAnalysisResult['experienceLevel'])) {
    return raw as JdAnalysisResult['experienceLevel'];
  }
  if (/lead|principal|staff|architect|director|vp|head/i.test(raw)) return 'Lead';
  if (/senior|sr/i.test(raw)) return 'Senior';
  if (/entry|junior|jr|fresher|graduate|intern/i.test(raw)) return 'Entry';
  if (/executive|director|vp/i.test(raw)) return 'Executive';
  return 'Mid';
}

function normalizeInterviewMode(value: unknown): InterviewMode {
  const raw = String(value ?? 'conversational') as InterviewMode;
  return INTERVIEW_MODES.has(raw) ? raw : 'conversational';
}

function normalizeDifficulty(value: unknown): InterviewDifficulty {
  const raw = String(value ?? 'medium') as InterviewDifficulty;
  return DIFFICULTIES.has(raw) ? raw : 'medium';
}

function normalizeStringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeResult(raw: Partial<JdAnalysisResult>): JdAnalysisResult {
  const durationMinutes = [15, 30, 45, 60].includes(Number(raw.durationMinutes))
    ? Number(raw.durationMinutes)
    : 30;
  const questionCount = [4, 6, 8].includes(Number(raw.questionCount))
    ? Number(raw.questionCount)
    : durationMinutes >= 45
      ? 8
      : durationMinutes >= 30
        ? 6
        : 4;

  const isCoder = Boolean(raw.isCoder);
  const focus = (raw.focusAreas ?? {}) as Partial<JdAnalysisResult['focusAreas']>;

  return {
    domain: String(raw.domain ?? 'General Professional').trim() || 'General Professional',
    company: String(raw.company ?? '').trim(),
    targetRole: String(raw.targetRole ?? 'Professional Candidate').trim() || 'Professional Candidate',
    experienceLevel: normalizeExperienceLevel(raw.experienceLevel),
    skills: normalizeStringArray(raw.skills, 8),
    technologies: normalizeStringArray(raw.technologies, 8),
    responsibilities: normalizeStringArray(raw.responsibilities, 5),
    technicalTopics: normalizeStringArray(raw.technicalTopics, 5),
    behavioralTopics: normalizeStringArray(raw.behavioralTopics, 4),
    interviewType: normalizeInterviewMode(raw.interviewType),
    difficulty: normalizeDifficulty(raw.difficulty),
    durationMinutes,
    questionCount,
    isCoder,
    focusAreas: {
      technical: focus.technical !== false,
      coding: isCoder && focus.coding !== false,
      behavioral: focus.behavioral !== false,
      problemSolving: focus.problemSolving !== false,
      communication: focus.communication !== false,
    },
  };
}

export async function analyzeJobDescription(
  jdText: string,
  context?: JdAnalysisOptionalContext,
): Promise<JdAnalysisResult> {
  const trimmed = jdText.trim();
  if (trimmed.length < MIN_JD_CHARS) {
    throw new AppError(
      400,
      'Job description is too short. Please provide at least a few sentences.',
    );
  }
  if (trimmed.length > MAX_JD_CHARS) {
    throw new AppError(
      400,
      `Job description exceeds ${MAX_JD_CHARS.toLocaleString()} characters.`,
    );
  }

  logger.info('[jd-analysis] analyzing job description', { length: trimmed.length });

  const prompt = buildJdAnalysisPrompt(trimmed, context);
  const raw = await aiService.generateJSON<Partial<JdAnalysisResult>>(prompt, {
    maxOutputTokens: 4096,
    temperature: 0.2,
  });

  const result = normalizeResult(raw);

  // JD interviews are voice-only with read-only code snippets — never live coding mode.
  if (result.interviewType === 'coding') {
    result.interviewType = 'conversational';
  }

  if (context?.company?.trim() && !result.company) {
    result.company = context.company.trim();
  }
  if (context?.targetRole?.trim()) {
    result.targetRole = context.targetRole.trim();
  }
  if (context?.experienceLevel?.trim() && context.experienceLevel !== 'Any') {
    result.experienceLevel = normalizeExperienceLevel(context.experienceLevel);
  }
  if (context?.interviewType) {
    result.interviewType = context.interviewType;
  }
  if (context?.difficulty) {
    result.difficulty = context.difficulty;
  }
  if (context?.durationMinutes) {
    result.durationMinutes = context.durationMinutes;
  }

  if (result.skills.length === 0) {
    result.skills = [result.targetRole];
  }

  logger.info('[jd-analysis] analysis complete', {
    domain: result.domain,
    role: result.targetRole,
    skills: result.skills.length,
  });

  return result;
}

export async function ocrJobDescriptionImage(input: {
  fileBase64: string;
  fileName?: string;
  mimeType?: string;
}): Promise<{ text: string; extractedText: string }> {
  const base64 = input.fileBase64?.replace(/^data:[^;]+;base64,/, '').trim();
  if (!base64) {
    throw new AppError(400, 'No image data provided.');
  }
  if (base64.length > MAX_IMAGE_BASE64_CHARS) {
    throw new AppError(400, 'Image is too large. Please upload a file under 10MB.');
  }

  const mimeType = input.mimeType?.trim() || 'image/png';
  if (!mimeType.startsWith('image/')) {
    throw new AppError(400, 'Only image files are supported for OCR.');
  }

  logger.info('[jd-analysis] OCR job description image', {
    fileName: input.fileName,
    mimeType,
  });

  const model = getActiveGeminiModel();
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new AppError(504, 'Image OCR timed out. Please try again.')),
      GEMINI_REQUEST_TIMEOUT_MS,
    );
  });

  const request = getGenAI().models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: buildJdOcrPrompt() },
        ],
      },
    ],
    config: {
      temperature: 0.1,
      maxOutputTokens: 8192,
    },
  });

  const response = await Promise.race([request, timeout]);
  const text = response.text?.trim() ?? '';

  if (text.length < MIN_JD_CHARS) {
    throw new AppError(
      400,
      'Could not extract enough readable text from this image. Try a clearer photo or paste the JD as text.',
    );
  }

  return { text, extractedText: text };
}
