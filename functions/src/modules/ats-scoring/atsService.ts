import { admin, db } from "../../config/firebase";
import { geminiModel } from "../../config/gemini";
import { logger } from "../../shared/logger";
import { AppError } from "../../shared/utils";
import { AtsAnalysisDoc, AtsAnalysisResult } from "./ats.types";

class AtsService {
  async analyzeResume(
    userId: string,
    resumeText: string,
    jobDescription: string,
  ): Promise<{ analysisId: string } & AtsAnalysisResult> {
    try {
      const prompt = this.buildPrompt(resumeText, jobDescription);
      const analysisResult = await geminiModel.generateJSON<AtsAnalysisResult>(
        prompt,
        {
          temperature: 0.2,
          maxOutputTokens: 2048,
        },
      );

      if (typeof analysisResult.matchScore !== "number") {
        throw new AppError(502, "AI returned invalid analysis format");
      }

      const docRef = await db.collection("atsAnalyses").add({
        userId,
        resumeSnippet: resumeText.substring(0, 500),
        jobTitle: this.extractJobTitle(jobDescription),
        analysisResult,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.debug(
        `[atsService] Analysis saved id=${docRef.id} for user=${userId}`,
      );

      return {
        analysisId: docRef.id,
        ...analysisResult,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error("[atsService] analyzeResume error", error);
      throw new AppError(500, "Failed to analyze resume");
    }
  }

  async getHistory(
    userId: string,
    limit: number = 10,
  ): Promise<(AtsAnalysisDoc & { id: string })[]> {
    try {
      const snapshot = await db
        .collection("atsAnalyses")
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();

      return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          userId: data.userId,
          resumeSnippet: data.resumeSnippet,
          jobTitle: data.jobTitle,
          analysisResult: data.analysisResult,
          createdAt: data.createdAt?.toDate?.().toISOString() || "",
        };
      });
    } catch (error) {
      logger.error("[atsService] getHistory error", error);
      throw new AppError(500, "Failed to fetch history");
    }
  }

  async getAnalysisById(
    userId: string,
    analysisId: string,
  ): Promise<AtsAnalysisDoc & { id: string }> {
    try {
      const doc = await db.collection("atsAnalyses").doc(analysisId).get();

      if (!doc.exists) {
        throw new AppError(404, "Analysis not found");
      }

      const data = doc.data() as AtsAnalysisDoc;

      if (data.userId !== userId) {
        throw new AppError(403, "Unauthorized to view this analysis");
      }

      return {
        id: doc.id,
        ...data,
        createdAt:
          (doc.data()?.createdAt as any)?.toDate?.().toISOString() || "",
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error("[atsService] getAnalysisById error", error);
      throw new AppError(500, "Failed to fetch analysis");
    }
  }

  async deleteAnalysis(userId: string, analysisId: string): Promise<boolean> {
    try {
      const doc = await db.collection("atsAnalyses").doc(analysisId).get();

      if (!doc.exists) {
        throw new AppError(404, "Analysis not found");
      }

      if (doc.data()?.userId !== userId) {
        throw new AppError(403, "Unauthorized to delete this analysis");
      }

      await db.collection("atsAnalyses").doc(analysisId).delete();
      logger.debug(`[atsService] Analysis deleted id=${analysisId}`);
      return true;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error("[atsService] deleteAnalysis error", error);
      throw new AppError(500, "Failed to delete analysis");
    }
  }

  private buildPrompt(resumeText: string, jobDescription: string): string {
    return `
    You are an expert ATS (Applicant Tracking System) and Senior Technical Recruiter.
    Analyze the RESUME against the JOB DESCRIPTION (JD).

    Calculate a matchScore out of 100 using these weights:
    1. Keyword Match (40%): Hard skills from JD present in resume
    2. Semantic Relevance (30%): Does experience context match JD requirements?
    3. Formatting & Structure (15%): Standard headers, easy to parse
    4. Impact & Metrics (15%): Quantifiable achievements (numbers, %, $)

    Return ONLY a valid JSON object with this exact structure:
    {
    "matchScore": <number 0-100>,
    "missingKeywords": [<string>],
    "matchedKeywords": [<string>],
    "strengths": [<string>],
    "actionableTips": [<string>],
    "formattingIssues": [<string>],
    "summary": "<2-sentence summary of candidate fit>"
    }

    RESUME:
    ${resumeText}

    JOB DESCRIPTION:
    ${jobDescription}
        `.trim();
  }

  private extractJobTitle(jd: string): string {
    const firstLine =
      jd.split("\n").find((line) => line.trim().length > 0) || "";
    return firstLine.substring(0, 80).trim();
  }
}

export const atsService = new AtsService();
