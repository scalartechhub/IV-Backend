import { admin, db } from "../../config/firebase";
import { geminiModel } from "../../config/gemini";
import {
  ROLE_BENCHMARKS,
  RoleBenchmark,
} from "../../constants/roles-benchmarks";
import { logger } from "../../shared/logger";
import { AppError } from "../../shared/utils";
import { AtsAnalysisDoc, AtsAnalysisResult, ParsedResume } from "./ats.types";

class AtsService {
  async analyzeResume(
    userId: string,
    resumeText: string | undefined,
    jobDescription: string | undefined,
    parsedResume?: ParsedResume,
    targetRole?: string,
  ): Promise<{ analysisId: string } & AtsAnalysisResult> {
    try {
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

      const analysisResult = await geminiModel.generateJSON<AtsAnalysisResult>(
        prompt,
        { temperature: 0.1, maxOutputTokens: 2048 },
      );

      if (typeof analysisResult.matchScore !== "number") {
        throw new AppError(502, "AI returned invalid analysis format");
      }

      const docRef = await db.collection("atsAnalyses").add({
        userId,
        resumeSnippet: formattedResume.substring(0, 500),
        jobTitle: comparisonTitle,
        analysisResult,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { analysisId: docRef.id, ...analysisResult };
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error("[atsService] analyzeResume error", error);
      throw new AppError(500, "Failed to analyze resume");
    }
  }

  private buildJDBasedPrompt(
    resumeText: string,
    jobDescription: string,
  ): string {
    return `
    You are an expert ATS. Compare the RESUME against the provided JOB DESCRIPTION.

    RESUME:
    ${resumeText}

    JOB DESCRIPTION:
    ${jobDescription}

    Return ONLY valid JSON: { "matchScore": number, "missingKeywords": string[], "matchedKeywords": string[], "strengths": string[], "actionableTips": string[], "formattingIssues": string[], "summary": string }
        `.trim();
  }

  private buildRoleBasedPrompt(
    resumeText: string,
    benchmark: RoleBenchmark,
  ): string {
    return `
    You are an expert ATS and Senior Technical Recruiter. 
    Compare the RESUME against the INDUSTRY STANDARD for a ${benchmark.title}.

    INDUSTRY STANDARD REQUIREMENTS FOR THIS ROLE:
    - Core Skills: ${benchmark.coreSkills.join(", ")}
    - Experience Level: ${benchmark.experienceLevel}
    - Soft Skills: ${benchmark.softSkills.join(", ")}

    RESUME:
    ${resumeText}

    Evaluate how well the resume matches this industry standard. 
    Return ONLY valid JSON: { "matchScore": number, "missingKeywords": string[], "matchedKeywords": string[], "strengths": string[], "actionableTips": string[], "formattingIssues": string[], "summary": string }
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
    if (parsed.skills?.length)
      text += `SKILLS:\n${parsed.skills.join(", ")}\n\n`;
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
    const firstLine =
      jd.split("\n").find((line) => line.trim().length > 0) || "";
    return firstLine.substring(0, 80).trim();
  }

  async getHistory(userId: string, limit: number = 10): Promise<AtsAnalysisDoc[]> {
    try {
      const snapshot = await db
        .collection("atsAnalyses")
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => {
        const data = doc.data() as AtsAnalysisDoc;
        return {
          ...data,
          id: doc.id,
          createdAt: (data.createdAt as any)?.toDate?.().toISOString() || "",
        };
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error("[atsService] getHistory error", error);
      throw new AppError(500, "Failed to retrieve analysis history");
    }
  }

  async getAnalysisById(userId: string, analysisId: string): Promise<AtsAnalysisDoc> {
    try {
      const doc = await db.collection("atsAnalyses").doc(analysisId).get();
      if (!doc.exists) throw new AppError(404, "Analysis not found");
      const data = doc.data() as AtsAnalysisDoc;
      if (data?.userId !== userId) throw new AppError(403, "Forbidden: you do not own this analysis");
      return {
        ...data,
        id: doc.id,
        createdAt: (data?.createdAt as any)?.toDate?.().toISOString() || "",
      };
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
