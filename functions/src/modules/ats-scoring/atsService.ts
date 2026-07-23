import { admin, db } from "../../config/firebase";
import { geminiModel } from "../../config/gemini";
import {
  ROLE_BENCHMARKS,
  RoleBenchmark,
} from "../../constants/roles-benchmarks";
import { logger } from "../../shared/logger";
import { AppError } from "../../shared/utils";
import {
  AtsAnalysisDoc,
  AtsScorePayload,
  MetricScore,
  ParsedResume,
  PositiveItem,
  ResumeAnalysisResponse,
  Suggestion,
} from "./ats.types";

const clampScore = (value: unknown, fallback = 0): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
};

const normalizeMetric = (raw: Partial<MetricScore> | undefined): MetricScore => ({
  score: clampScore(raw?.score),
  change: Number.isFinite(Number(raw?.change)) ? Math.round(Number(raw?.change)) : 0,
});

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
        const text = typeof (item as PositiveItem).text === "string"
          ? (item as PositiveItem).text.trim()
          : "";
        if (text) return { text };
      }
      return null;
    })
    .filter((item): item is PositiveItem => item !== null)
    .slice(0, 8);
};

const normalizeScorePayload = (raw: AtsScorePayload): AtsScorePayload => ({
  overallScore: clampScore(raw.overallScore),
  peerPercentile: clampScore(raw.peerPercentile),
  experience:
    typeof raw.experience === "string" && raw.experience.trim()
      ? raw.experience.trim()
      : undefined,
  targetRole:
    typeof raw.targetRole === "string" && raw.targetRole.trim()
      ? raw.targetRole.trim()
      : undefined,
  subMetrics: {
    ats: clampScore(raw.subMetrics?.ats),
    impact: clampScore(raw.subMetrics?.impact),
    clarity: clampScore(raw.subMetrics?.clarity),
  },
  detailedMetrics: {
    keywordMatch: normalizeMetric(raw.detailedMetrics?.keywordMatch),
    quantifiedImpact: normalizeMetric(raw.detailedMetrics?.quantifiedImpact),
    actionVerbs: normalizeMetric(raw.detailedMetrics?.actionVerbs),
    structureLength: normalizeMetric(raw.detailedMetrics?.structureLength),
  },
  fixSuggestions: normalizeSuggestions(raw.fixSuggestions),
  workingWell: normalizeWorkingWell(raw.workingWell),
});

const SCORE_JSON_SHAPE = `{
  "overallScore": number (0-100),
  "peerPercentile": number (0-100, percent of peers this resume is above),
  "experience": "e.g. 5+ yrs",
  "targetRole": "inferred or confirmed role title",
  "subMetrics": { "ats": number, "impact": number, "clarity": number },
  "detailedMetrics": {
    "keywordMatch": { "score": number, "change": number },
    "quantifiedImpact": { "score": number, "change": number },
    "actionVerbs": { "score": number, "change": number },
    "structureLength": { "score": number, "change": number }
  },
  "fixSuggestions": [
    { "type": "warning" | "info", "icon": "warning" | "info", "text": string, "priority": number }
  ],
  "workingWell": [ { "text": string } ]
}`;

class AtsService {
  async analyzeResume(
    userId: string,
    resumeText: string | undefined,
    jobDescription: string | undefined,
    parsedResume?: ParsedResume,
    targetRole?: string,
    resumeId?: string,
    fileName?: string,
    experience?: string,
  ): Promise<ResumeAnalysisResponse> {
    try {
      if (!resumeId) {
        throw new AppError(400, "resumeId is required");
      }

      logger.debug("[atsService] analyzeResume started", {
        userId,
        resumeId,
        targetRole,
        hasParsedResume: !!parsedResume,
        hasResumeText: !!resumeText,
      });

      const formattedResume = parsedResume
        ? this.formatParsedResume(parsedResume)
        : resumeText;

      if (!formattedResume) {
        throw new AppError(400, "No resume data provided");
      }

      let prompt = "";
      let comparisonTitle = "";

      if (targetRole) {
        const benchmark = ROLE_BENCHMARKS[targetRole];
        if (!benchmark) {
          throw new AppError(
            400,
            `Invalid target role: ${targetRole}. Please select a valid role.`,
          );
        }
        comparisonTitle = benchmark.title;
        prompt = this.buildRoleBasedPrompt(formattedResume, benchmark);
      } else if (jobDescription) {
        comparisonTitle = this.extractJobTitle(jobDescription);
        prompt = this.buildJDBasedPrompt(formattedResume, jobDescription);
      } else {
        throw new AppError(
          400,
          "Either jobDescription or targetRole is required",
        );
      }

      logger.debug("[atsService] Calling Gemini API");
      const raw = await geminiModel.generateJSON<AtsScorePayload>(prompt, {
        temperature: 0.1,
        maxOutputTokens: 2048,
      });

      if (typeof raw.overallScore !== "number" && typeof raw.overallScore !== "string") {
        throw new AppError(502, "AI returned invalid analysis format");
      }

      const scores = normalizeScorePayload(raw);
      const analyzedAt = new Date().toISOString();
      const resolvedTargetRole =
        scores.targetRole || comparisonTitle || targetRole || "Unknown role";
      const resolvedExperience =
        (typeof experience === "string" && experience.trim()) ||
        scores.experience ||
        "";
      const resolvedFileName =
        (typeof fileName === "string" && fileName.trim()) || "resume.pdf";

      const response: ResumeAnalysisResponse = {
        resumeId,
        fileName: resolvedFileName,
        targetRole: resolvedTargetRole,
        experience: resolvedExperience,
        aiReviewed: true,
        overallScore: scores.overallScore,
        peerPercentile: scores.peerPercentile,
        subMetrics: scores.subMetrics,
        detailedMetrics: scores.detailedMetrics,
        fixSuggestions: scores.fixSuggestions,
        workingWell: scores.workingWell,
        analyzedAt,
      };

      logger.debug("[atsService] Saving to Firestore", {
        userId,
        resumeId,
        targetRole: resolvedTargetRole,
      });

      const docRef = await db.collection("atsAnalyses").add({
        userId,
        resumeId,
        fileName: response.fileName,
        targetRole: response.targetRole,
        experience: response.experience,
        aiReviewed: true,
        overallScore: response.overallScore,
        peerPercentile: response.peerPercentile,
        subMetrics: response.subMetrics,
        detailedMetrics: response.detailedMetrics,
        fixSuggestions: response.fixSuggestions,
        workingWell: response.workingWell,
        analyzedAt,
        resumeSnippet: formattedResume.substring(0, 500),
        jobTitle: comparisonTitle,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info("[atsService] Analysis saved successfully", {
        analysisId: docRef.id,
        resumeId,
        overallScore: response.overallScore,
      });

      return response;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error("[atsService] analyzeResume error", error);
      throw new AppError(500, "Failed to analyze resume");
    }
  }

  async getAnalysisByResumeId(
    userId: string,
    resumeId: string,
  ): Promise<ResumeAnalysisResponse | null> {
    try {
      logger.debug("[atsService] getAnalysisByResumeId called", { userId, resumeId });

      const snapshot = await db
        .collection("atsAnalyses")
        .where("userId", "==", userId)
        .where("resumeId", "==", resumeId)
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();

      if (snapshot.empty) {
        logger.info("[atsService] No analysis found for resumeId", resumeId);
        return null;
      }

      return this.toResponse(snapshot.docs[0].id, snapshot.docs[0].data() as AtsAnalysisDoc);
    } catch (error: any) {
      logger.warn(
        "[atsService] getAnalysisByResumeId failed (likely missing index or empty collection). Returning null.",
        error,
      );
      return null;
    }
  }

  private buildJDBasedPrompt(resumeText: string, jobDescription: string): string {
    return `
You are an expert ATS and resume coach. Score the RESUME against the JOB DESCRIPTION for a hiring dashboard.

RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

Scoring guidance:
- overallScore: holistic resume quality for this JD (0-100)
- peerPercentile: approximate % of peers this resume beats for this role (0-100)
- subMetrics.ats: ATS parse/keyword friendliness
- subMetrics.impact: quantified achievements / business outcomes
- subMetrics.clarity: structure, readability, seniority signal
- detailedMetrics.*.change: estimated lift vs a typical peer resume for this role (can be negative)
- fixSuggestions: 2-5 high-impact edits ranked by priority (1 = highest). type "warning" for critical, "info" for nice-to-have
- workingWell: 2-5 strengths hiring managers notice

Return ONLY valid JSON matching this shape (no markdown):
${SCORE_JSON_SHAPE}
`.trim();
  }

  private buildRoleBasedPrompt(resumeText: string, benchmark: RoleBenchmark): string {
    return `
You are an expert ATS and Senior Technical Recruiter scoring a resume for a hiring dashboard.
Compare the RESUME against the INDUSTRY STANDARD for a ${benchmark.title}.

INDUSTRY STANDARD REQUIREMENTS FOR THIS ROLE:
- Core Skills: ${benchmark.coreSkills.join(", ")}
- Experience Level: ${benchmark.experienceLevel}
- Soft Skills: ${benchmark.softSkills.join(", ")}

RESUME:
${resumeText}

Scoring guidance:
- overallScore: holistic match to this role (0-100)
- peerPercentile: approximate % of peers this resume beats for this role (0-100)
- Infer experience as a short string like "5+ yrs" when possible
- subMetrics.ats / impact / clarity as 0-100
- detailedMetrics scores 0-100 with change vs typical peer (can be negative)
- fixSuggestions: 2-5 ranked edits (priority 1 = highest). type "warning" or "info"
- workingWell: 2-5 strengths

Return ONLY valid JSON matching this shape (no markdown):
${SCORE_JSON_SHAPE}
`.trim();
  }

  getAvailableRoles(): { id: string; title: string }[] {
    return Object.keys(ROLE_BENCHMARKS).map((key) => ({
      id: key,
      title: ROLE_BENCHMARKS[key].title,
    }));
  }

  private formatParsedResume(parsed: ParsedResume): string {
    let text = "";
    if (parsed.skills?.length) text += `SKILLS:\n${parsed.skills.join(", ")}\n\n`;
    if (parsed.experience?.length) {
      text += `EXPERIENCE:\n`;
      parsed.experience.forEach((exp) => {
        text += `- ${exp.title} at ${exp.company} (${exp.duration}): ${exp.description}\n`;
      });
      text += `\n`;
    }
    if (parsed.projects?.length) {
      text += `PROJECTS:\n`;
      parsed.projects.forEach((proj) => {
        text += `- ${proj.name}: ${proj.description}\n`;
      });
      text += `\n`;
    }
    if (parsed.education?.length) {
      text += `EDUCATION:\n`;
      parsed.education.forEach((edu) => {
        text += `- ${edu.degree}, ${edu.university}, ${edu.year}\n`;
      });
      text += `\n`;
    }
    return text.trim();
  }

  private extractJobTitle(jd: string): string {
    const firstLine = jd.split("\n").find((line) => line.trim().length > 0) || "";
    return firstLine.substring(0, 80).trim();
  }

  private toResponse(id: string, data: AtsAnalysisDoc): ResumeAnalysisResponse {
    const analyzedAt =
      data.analyzedAt ||
      (data.createdAt as any)?.toDate?.().toISOString?.() ||
      (typeof data.createdAt === "string" ? data.createdAt : "") ||
      "";

    // Legacy docs (matchScore / strengths) — map best-effort if needed
    const legacy = data as AtsAnalysisDoc & {
      analysisResult?: {
        matchScore?: number;
        strengths?: string[];
        actionableTips?: string[];
      };
      matchScore?: number;
    };

    const overallScore = clampScore(
      data.overallScore ?? legacy.analysisResult?.matchScore ?? legacy.matchScore,
    );

    return {
      resumeId: data.resumeId || id,
      fileName: data.fileName || "resume.pdf",
      targetRole: data.targetRole || data.jobTitle || "",
      experience: data.experience || "",
      aiReviewed: data.aiReviewed ?? true,
      overallScore,
      peerPercentile: clampScore(data.peerPercentile),
      subMetrics: {
        ats: clampScore(data.subMetrics?.ats ?? overallScore),
        impact: clampScore(data.subMetrics?.impact),
        clarity: clampScore(data.subMetrics?.clarity),
      },
      detailedMetrics: {
        keywordMatch: normalizeMetric(data.detailedMetrics?.keywordMatch),
        quantifiedImpact: normalizeMetric(data.detailedMetrics?.quantifiedImpact),
        actionVerbs: normalizeMetric(data.detailedMetrics?.actionVerbs),
        structureLength: normalizeMetric(data.detailedMetrics?.structureLength),
      },
      fixSuggestions:
        data.fixSuggestions?.length
          ? normalizeSuggestions(data.fixSuggestions)
          : normalizeSuggestions(
              (legacy.analysisResult?.actionableTips ?? []).map((text, i) => ({
                type: "warning" as const,
                icon: "warning",
                text,
                priority: i + 1,
              })),
            ),
      workingWell:
        data.workingWell?.length
          ? normalizeWorkingWell(data.workingWell)
          : normalizeWorkingWell(legacy.analysisResult?.strengths ?? []),
      analyzedAt,
    };
  }

  async getHistory(userId: string, limit: number = 10): Promise<ResumeAnalysisResponse[]> {
    try {
      const snapshot = await db
        .collection("atsAnalyses")
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) =>
        this.toResponse(doc.id, doc.data() as AtsAnalysisDoc),
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error("[atsService] getHistory error", error);
      throw new AppError(500, "Failed to retrieve analysis history");
    }
  }

  async getAnalysisById(userId: string, analysisId: string): Promise<ResumeAnalysisResponse> {
    try {
      const doc = await db.collection("atsAnalyses").doc(analysisId).get();
      if (!doc.exists) throw new AppError(404, "Analysis not found");
      const data = doc.data() as AtsAnalysisDoc;
      if (data?.userId !== userId) throw new AppError(403, "Forbidden: you do not own this analysis");
      return this.toResponse(doc.id, data);
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error("[atsService] getAnalysisById error", error);
      throw new AppError(500, "Failed to retrieve analysis");
    }
  }

  async deleteAnalysis(userId: string, analysisId: string): Promise<boolean> {
    try {
      const doc = await db.collection("atsAnalyses").doc(analysisId).get();
      if (!doc.exists) throw new AppError(404, "Analysis not found");
      if (doc.data()?.userId !== userId) throw new AppError(403, "Forbidden: you do not own this analysis");
      await db.collection("atsAnalyses").doc(analysisId).delete();
      return true;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error("[atsService] deleteAnalysis error", error);
      throw new AppError(500, "Failed to delete analysis");
    }
  }
}

export const atsService = new AtsService();
