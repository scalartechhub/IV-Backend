import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../config/firebase";
import {
  COLLECTIONS,
  INTERVIEW_DOCUMENT_VERSION,
  LEGACY_COLLECTIONS,
} from "../../shared/constants";
import { toReportDocId } from "../../shared/firestore-ids";
import { logger } from "../../shared/logger";
import {
  InterviewStatus,
  InterviewType,
  QuestionDifficulty,
  type Interview,
  type InterviewQuestion,
  type InterviewReport,
} from "../interview/interview.types";
import { getRawEvaluationScore } from "../interview/interview.scoring";

export interface MigrationResult {
  interviewsProcessed: number;
  interviewsMigrated: number;
  interviewsSkipped: number;
  usersStatsUpdated: number;
  errors: string[];
}

interface LegacyInterview {
  id: string;
  userId: string;
  role?: string;
  experience?: string;
  type?: string;
  status?: string;
  totalQuestions?: number;
  answeredQuestions?: number;
  overallPerformance?: number;
  resumeURL?: string;
  jdURL?: string;
  resumeAnalysis?: Interview["resumeAnalysis"];
  jdAnalysis?: Interview["jdAnalysis"];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  completedAt?: Timestamp;
}

interface LegacyQuestion {
  id: string;
  interviewId: string;
  question: string;
  difficulty: string;
  category?: string;
  order: number;
}

interface LegacyAnswer {
  questionId: string;
  answer: string;
  submittedAt?: Timestamp;
  pending?: boolean;
}

interface LegacyEvaluation {
  questionId: string;
  technical: number;
  communication: number;
  completeness: number;
  confidence: number;
  feedback: string;
}

interface LegacyReport {
  interviewId: string;
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  createdAt?: Timestamp;
  pending?: boolean;
}

const mapLegacyStatus = (status?: string): InterviewStatus => {
  switch (status) {
    case "completed":
      return InterviewStatus.COMPLETED;
    case "in_progress":
    case "ready":
    case "processing":
      return InterviewStatus.STARTED;
    case "failed":
      return InterviewStatus.CANCELLED;
    default:
      return InterviewStatus.DRAFT;
  }
};

const mapLegacyType = (type?: string): InterviewType => {
  if (type === "behavioral") return InterviewType.HR;
  if (type === "mixed") return InterviewType.MIXED;
  return InterviewType.TECHNICAL;
};

const mapDifficulty = (value: string): QuestionDifficulty => {
  if (value === "easy") return QuestionDifficulty.EASY;
  if (value === "hard") return QuestionDifficulty.HARD;
  return QuestionDifficulty.MEDIUM;
};

export class MigrationService {
  async migrateAll(apply: boolean): Promise<MigrationResult> {
    const result: MigrationResult = {
      interviewsProcessed: 0,
      interviewsMigrated: 0,
      interviewsSkipped: 0,
      usersStatsUpdated: 0,
      errors: [],
    };

    const interviewsSnap = await db.collection(COLLECTIONS.INTERVIEWS).get();

    for (const doc of interviewsSnap.docs) {
      result.interviewsProcessed++;
      const legacy = doc.data() as LegacyInterview & { version?: number; questions?: unknown[] };

      if (legacy.version === INTERVIEW_DOCUMENT_VERSION && Array.isArray(legacy.questions)) {
        result.interviewsSkipped++;
        continue;
      }

      try {
        const migrated = await this.buildEmbeddedInterview(doc.id, legacy);

        if (apply) {
          await doc.ref.set(migrated, { merge: false });
          if (migrated.status === InterviewStatus.COMPLETED && migrated.overallScore !== undefined) {
            await this.updateUserStatsFromMigration(migrated.userId, migrated.overallScore);
            result.usersStatsUpdated++;
          }
        }

        result.interviewsMigrated++;
        logger.info(`[MigrationService] ${apply ? "migrated" : "planned"} interviewId=${doc.id}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`interview ${doc.id}: ${message}`);
        logger.error(`[MigrationService] failed interviewId=${doc.id}`, message);
      }
    }

    return result;
  }

  async verifyMigration(): Promise<{ ok: number; legacy: number; missingQuestions: string[] }> {
    const interviewsSnap = await db.collection(COLLECTIONS.INTERVIEWS).get();
    let ok = 0;
    let legacy = 0;
    const missingQuestions: string[] = [];

    for (const doc of interviewsSnap.docs) {
      const data = doc.data() as Interview;
      if (data.version === INTERVIEW_DOCUMENT_VERSION) {
        ok++;
        if (data.questionCount > 0 && data.questions.length === 0) {
          missingQuestions.push(doc.id);
        }
      } else {
        legacy++;
      }
    }

    return { ok, legacy, missingQuestions };
  }

  private async buildEmbeddedInterview(
    interviewId: string,
    legacy: LegacyInterview
  ): Promise<Interview> {
    const [questionsSnap, answersSnap, evaluationsSnap] = await Promise.all([
      db
        .collection(LEGACY_COLLECTIONS.QUESTIONS)
        .where("interviewId", "==", interviewId)
        .orderBy("order", "asc")
        .get(),
      db.collection(LEGACY_COLLECTIONS.ANSWERS).where("interviewId", "==", interviewId).get(),
      db.collection(LEGACY_COLLECTIONS.EVALUATIONS).where("interviewId", "==", interviewId).get(),
    ]);

    const legacyQuestions = questionsSnap.docs.map((d) => d.data() as LegacyQuestion);
    const answersByQuestion = new Map<string, LegacyAnswer>();
    for (const doc of answersSnap.docs) {
      const answer = doc.data() as LegacyAnswer;
      if (!answer.pending) {
        answersByQuestion.set(answer.questionId, answer);
      }
    }

    const evaluationsByQuestion = new Map<string, LegacyEvaluation>();
    for (const doc of evaluationsSnap.docs) {
      const evaluation = doc.data() as LegacyEvaluation;
      evaluationsByQuestion.set(evaluation.questionId, evaluation);
    }

    const questions: InterviewQuestion[] = legacyQuestions.map((q) => {
      const answer = answersByQuestion.get(q.id);
      const evaluation = evaluationsByQuestion.get(q.id);
      const score = evaluation
        ? getRawEvaluationScore({
            technical: evaluation.technical,
            communication: evaluation.communication,
            completeness: evaluation.completeness,
            confidence: evaluation.confidence,
            feedback: evaluation.feedback,
          })
        : undefined;

      return {
        id: q.id || uuidv4(),
        question: q.question,
        difficulty: mapDifficulty(q.difficulty),
        ...(answer && { answer: answer.answer, answeredAt: answer.submittedAt }),
        ...(evaluation && { score, feedback: evaluation.feedback }),
      };
    });

    const report = await this.loadLegacyReport(interviewId);
    const status = mapLegacyStatus(legacy.status);
    const overallScore =
      legacy.overallPerformance ??
      questions.reduce((sum, q) => sum + (q.score ?? 0), 0);

    return {
      id: interviewId,
      userId: legacy.userId,
      technology: legacy.role ?? "General",
      experienceLevel: legacy.experience ?? "Not specified",
      interviewType: mapLegacyType(legacy.type),
      status,
      overallScore,
      questionCount: questions.length,
      questions,
      ...(report && { report }),
      ...(legacy.resumeURL && { resumeUrl: legacy.resumeURL }),
      ...(legacy.jdURL && { jdUrl: legacy.jdURL }),
      ...(legacy.resumeAnalysis && { resumeAnalysis: legacy.resumeAnalysis }),
      ...(legacy.jdAnalysis && { jdAnalysis: legacy.jdAnalysis }),
      createdAt: legacy.createdAt ?? Timestamp.now(),
      updatedAt: legacy.updatedAt ?? Timestamp.now(),
      ...(status === InterviewStatus.COMPLETED && { completedAt: legacy.completedAt ?? legacy.updatedAt }),
      version: INTERVIEW_DOCUMENT_VERSION,
      isDeleted: false,
    };
  }

  private async loadLegacyReport(interviewId: string): Promise<InterviewReport | undefined> {
    const canonicalRef = db.collection(LEGACY_COLLECTIONS.REPORTS).doc(toReportDocId(interviewId));
    const canonicalSnap = await canonicalRef.get();

    let data: LegacyReport | undefined;
    if (canonicalSnap.exists) {
      data = canonicalSnap.data() as LegacyReport;
    } else {
      const legacySnap = await db
        .collection(LEGACY_COLLECTIONS.REPORTS)
        .where("interviewId", "==", interviewId)
        .limit(1)
        .get();
      if (!legacySnap.empty) {
        data = legacySnap.docs[0].data() as LegacyReport;
      }
    }

    if (!data || data.pending) return undefined;

    return {
      overallScore: data.overallScore,
      strengths: data.strengths ?? [],
      weaknesses: data.weaknesses ?? [],
      recommendations: data.recommendations ?? [],
      summary: "Migrated from legacy report.",
      generatedAt: data.createdAt ?? Timestamp.now(),
    };
  }

  private async updateUserStatsFromMigration(userId: string, score: number): Promise<void> {
    const ref = db.collection(COLLECTIONS.USERS).doc(userId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;

      const user = snap.data() as {
        completedInterviews?: number;
        averageScore?: number;
        bestScore?: number;
      };

      const completedInterviews = (user.completedInterviews ?? 0) + 1;
      const previousTotal = (user.averageScore ?? 0) * (user.completedInterviews ?? 0);
      const averageScore = Math.round((previousTotal + score) / completedInterviews);
      const bestScore = Math.max(user.bestScore ?? 0, score);

      tx.update(ref, {
        completedInterviews,
        averageScore,
        bestScore,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }
}

export const migrationService = new MigrationService();
