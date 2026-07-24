import { randomUUID } from "crypto";
import { aiService } from "./ai.service";
import { buildResumeParserPrompt } from "../interview/prompts/resume-parser.prompt";
import { buildResumeScorecardPrompt } from "../interview/prompts/resume-scorecard.prompt";
import { logger } from "../../shared/logger";
import { AppError } from "../../shared/utils";
import { extractPdfText } from "../../shared/utils/pdf";
import type { ResumeAnalysis } from "../interview/interview.types";
import { DIFFICULTY_LEVELS, INTERVIEW_TYPES } from "../../shared/constants";
import type {
  MetricScore,
  PositiveItem,
  ResumeAnalysisResponse,
  Suggestion,
} from "../ats-scoring/ats.types";

export type {
  MetricScore,
  PositiveItem,
  ResumeAnalysisResponse,
  Suggestion,
};

type ScorecardAiPayload = {
  overallScore: number;
  peerPercentile: number;
  experience?: string;
  targetRole?: string;
  subMetrics: ResumeAnalysisResponse["subMetrics"];
  detailedMetrics: ResumeAnalysisResponse["detailedMetrics"];
  fixSuggestions: Suggestion[];
  workingWell: PositiveItem[];
};

const clampScore = (value: unknown, fallback = 0): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
};

/** Snap to 0/5/10…100 so re-uploads don't jitter by a few points. */
const snapScore = (value: unknown, fallback = 0): number => {
  const clamped = clampScore(value, fallback);
  return Math.max(0, Math.min(100, Math.round(clamped / 5) * 5));
};

const snapChange = (score: number): number => {
  const raw = Math.round((score - 70) / 5) * 5;
  return Math.max(-10, Math.min(10, raw));
};

const normalizeMetric = (raw: Partial<MetricScore> | undefined): MetricScore => {
  const score = snapScore(raw?.score);
  return { score, change: snapChange(score) };
};

const normalizeResumeText = (text: string): string =>
  text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const normalizeSuggestions = (raw: unknown): Suggestion[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index): Suggestion | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as Partial<Suggestion>;
      const text = typeof row.text === "string" ? row.text.trim() : "";
      if (!text) return null;
      const type = row.type === "info" ? "info" : "warning";
      return {
        type,
        icon: typeof row.icon === "string" && row.icon.trim() ? row.icon.trim() : type,
        text,
        priority:
          Number.isFinite(Number(row.priority)) && Number(row.priority) > 0
            ? Math.round(Number(row.priority))
            : index + 1,
      };
    })
    .filter((item): item is Suggestion => item !== null)
    .slice(0, 8);
};

const normalizeWorkingWell = (raw: unknown): PositiveItem[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): PositiveItem | null => {
      if (typeof item === "string" && item.trim()) return { text: item.trim() };
      if (item && typeof item === "object") {
        const text =
          typeof (item as PositiveItem).text === "string"
            ? (item as PositiveItem).text.trim()
            : "";
        if (text) return { text };
      }
      return null;
    })
    .filter((item): item is PositiveItem => item !== null)
    .slice(0, 8);
};

export const extractTextFromPDF = async (buffer: Buffer): Promise<string> => {
  try {
    const data = await extractPdfText(buffer);

    if (!data.text || data.text.length < 20) {
      console.warn(
        `[Resume] PDF has no readable text.\n` +
          `  WHAT THIS MEANS: The uploaded PDF is empty, scanned as images only, or corrupted.\n` +
          `  HOW TO FIX:\n` +
          `  1. Upload a text-based PDF (not a scanned photo/image PDF).\n` +
          `  2. Re-export the resume from Word/Google Docs as PDF.\n` +
          `  3. Try a different PDF file.`
      );
      throw new AppError(
        400,
        "Your resume PDF is empty or unreadable. Please upload a text-based PDF."
      );
    }

    logger.debug("[resume-parser] extracted text", { chars: data.text.length, pages: data.numpages });
    return data.text;
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error("[resume-parser] PDF extraction failed", error);
    console.error(
      `[Resume] Could not read the PDF file.\n` +
        `  WHAT THIS MEANS: The file is corrupted or not a valid PDF.\n` +
        `  HOW TO FIX:\n` +
        `  1. Make sure the file extension is .pdf.\n` +
        `  2. Re-download or re-export the resume and upload again.\n` +
        `  3. Keep file size under 10 MB.`
    );
    throw new AppError(
      400,
      "Could not read your resume PDF. Please upload a valid, text-based PDF file."
    );
  }
};

export const parseResume = async (pdfBuffer: Buffer): Promise<ResumeAnalysis> => {
  logger.info("[resume-parser] starting resume parse");

  const text = await extractTextFromPDF(pdfBuffer);
  const prompt = buildResumeParserPrompt(text);
  const analysis = await aiService.generateJSON<ResumeAnalysis>(prompt);

  if (!Array.isArray(analysis.skills)) analysis.skills = [];
  if (!Array.isArray(analysis.projects)) analysis.projects = [];
  if (!Array.isArray(analysis.experience)) analysis.experience = [];
  if (!Array.isArray(analysis.education)) analysis.education = [];

  const normalizedInterviewType =
    typeof analysis.interviewType === "string" ? analysis.interviewType.trim() : "";
  const normalizedDifficultyLevel =
    typeof analysis.difficultyLevel === "string" ? analysis.difficultyLevel.trim() : "";

  analysis.fullName =
    typeof analysis.fullName === "string" && analysis.fullName.trim().length > 0
      ? analysis.fullName.trim()
      : undefined;
  analysis.email =
    typeof analysis.email === "string" && analysis.email.trim().length > 0
      ? analysis.email.trim()
      : undefined;
  analysis.phone =
    typeof analysis.phone === "string" && analysis.phone.trim().length > 0
      ? analysis.phone.trim()
      : undefined;
  analysis.location =
    typeof analysis.location === "string" && analysis.location.trim().length > 0
      ? analysis.location.trim()
      : undefined;
  analysis.yearsOfExperience =
    typeof analysis.yearsOfExperience === "string" && analysis.yearsOfExperience.trim().length > 0
      ? analysis.yearsOfExperience.trim()
      : undefined;
  analysis.targetRole =
    typeof analysis.targetRole === "string" && analysis.targetRole.trim().length > 0
      ? analysis.targetRole.trim()
      : undefined;
  analysis.domain =
    typeof analysis.domain === "string" && analysis.domain.trim().length > 0
      ? analysis.domain.trim()
      : undefined;
  analysis.category =
    typeof analysis.category === "string" && analysis.category.trim().length > 0
      ? analysis.category.trim()
      : undefined;
  analysis.specification =
    typeof analysis.specification === "string" && analysis.specification.trim().length > 0
      ? analysis.specification.trim()
      : undefined;
  analysis.interviewType = INTERVIEW_TYPES.includes(
    normalizedInterviewType as (typeof INTERVIEW_TYPES)[number]
  )
    ? (normalizedInterviewType as ResumeAnalysis["interviewType"])
    : undefined;
  analysis.difficultyLevel = DIFFICULTY_LEVELS.includes(
    normalizedDifficultyLevel as (typeof DIFFICULTY_LEVELS)[number]
  )
    ? (normalizedDifficultyLevel as ResumeAnalysis["difficultyLevel"])
    : undefined;

  logger.info("[resume-parser] parse complete", {
    skills: analysis.skills.length,
    projects: analysis.projects.length,
    targetRole: analysis.targetRole,
  });

  return analysis;
};

/** Scorecard analysis for the resume dashboard — does not persist anything. */
export const analyzeResumeScorecard = async (
  pdfBuffer: Buffer,
  fileName?: string,
  /** Stable id — use userId so `resumes/{userId}` can upsert. */
  resumeId: string = randomUUID()
): Promise<ResumeAnalysisResponse> => {
  logger.info("[resume-parser] starting resume scorecard analysis");

  const text = normalizeResumeText(await extractTextFromPDF(pdfBuffer));
  const prompt = buildResumeScorecardPrompt(text, fileName);
  const raw = await aiService.generateJSON<ScorecardAiPayload>(prompt, {
    temperature: 0,
    // Scorecard JSON is ~1–2k tokens; keep headroom in case a model ignores thinkingBudget.
    maxOutputTokens: 8192,
  });

  if (typeof raw.overallScore !== "number" && typeof raw.overallScore !== "string") {
    throw new AppError(502, "AI returned invalid resume analysis format");
  }

  const subMetrics = {
    ats: snapScore(raw.subMetrics?.ats),
    impact: snapScore(raw.subMetrics?.impact),
    clarity: snapScore(raw.subMetrics?.clarity),
  };
  const detailedMetrics = {
    keywordMatch: normalizeMetric(raw.detailedMetrics?.keywordMatch),
    quantifiedImpact: normalizeMetric(raw.detailedMetrics?.quantifiedImpact),
    actionVerbs: normalizeMetric(raw.detailedMetrics?.actionVerbs),
    structureLength: normalizeMetric(raw.detailedMetrics?.structureLength),
  };

  // Deterministic overall/peer from metric average so re-uploads stay stable.
  const metricAverage =
    (subMetrics.ats +
      subMetrics.impact +
      subMetrics.clarity +
      detailedMetrics.keywordMatch.score +
      detailedMetrics.quantifiedImpact.score +
      detailedMetrics.actionVerbs.score +
      detailedMetrics.structureLength.score) /
    7;
  const overallScore = snapScore(metricAverage);
  const peerPercentile = snapScore(overallScore - 5);

  const response: ResumeAnalysisResponse = {
    resumeId,
    fileName:
      typeof fileName === "string" && fileName.trim().length > 0
        ? fileName.trim()
        : "resume.pdf",
    targetRole:
      typeof raw.targetRole === "string" && raw.targetRole.trim().length > 0
        ? raw.targetRole.trim()
        : "Unknown role",
    experience:
      typeof raw.experience === "string" && raw.experience.trim().length > 0
        ? raw.experience.trim()
        : "",
    aiReviewed: true,
    overallScore,
    peerPercentile,
    subMetrics,
    detailedMetrics,
    fixSuggestions: normalizeSuggestions(raw.fixSuggestions),
    workingWell: normalizeWorkingWell(raw.workingWell),
    analyzedAt: new Date().toISOString(),
  };

  logger.info("[resume-parser] scorecard complete", {
    overallScore: response.overallScore,
    targetRole: response.targetRole,
  });

  return response;
};
