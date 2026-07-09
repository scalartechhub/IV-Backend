import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../config/firebase";
import { COLLECTIONS, INTERVIEW_DOCUMENT_VERSION } from "../../shared/constants";
import { AppError } from "../../shared/utils";
import type {
  CreateInterviewInput,
  Interview,
  InterviewQuestion,
  InterviewReport,
  InterviewSummary,
  RawQuestion,
  DifficultyLevel,
  InterviewType,
} from "./interview.types";
import { InterviewStatus, toQuestionDifficulty } from "./interview.types";
import { InterviewMode } from "./interview.types";

export const createInterview = async (
  userId: string,
  input: CreateInterviewInput
): Promise<Interview> => {
  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc();
  const now = FieldValue.serverTimestamp();

  await ref.set({
    id: ref.id,
    userId,
    domain: input.domain,
    category: input.category,
    specification: input.specification,
    targetRole: input.targetRole,
    experienceLevel: input.experienceLevel,
    mode: InterviewMode.PAYLOAD,
    difficultyLevel: input.difficultyLevel,
    interviewType: input.interviewType,
    durationMinutes: input.durationMinutes,
    questionCount: input.questionCount,
    status: InterviewStatus.DRAFT,
    questions: [],
    version: INTERVIEW_DOCUMENT_VERSION,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  });

  return (await ref.get()).data() as Interview;
};

export const createInterviewWithDocuments = async (
  userId: string,
  settings: {
    domain: string;
    category: string;
    specification: string;
    targetRole: string;
    experienceLevel?: string;
    difficultyLevel: DifficultyLevel;
    interviewType: InterviewType;
    durationMinutes: number;
    questionCount: number;
  }
): Promise<Interview> => {
  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc();
  const now = FieldValue.serverTimestamp();

  await ref.set({
    id: ref.id,
    userId,
    mode: InterviewMode.DOCUMENTS,
    domain: settings.domain,
    category: settings.category,
    specification: settings.specification,
    targetRole: settings.targetRole,
    experienceLevel: settings.experienceLevel,
    difficultyLevel: settings.difficultyLevel,
    interviewType: settings.interviewType,
    durationMinutes: settings.durationMinutes,
    questionCount: settings.questionCount,
    status: InterviewStatus.DRAFT,
    questions: [],
    version: INTERVIEW_DOCUMENT_VERSION,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  });

  return (await ref.get()).data() as Interview;
};

export const findInterviewById = async (interviewId: string): Promise<Interview | null> => {
  const snap = await db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId).get();
  if (!snap.exists) return null;

  const interview = snap.data() as Interview;
  if (interview.isDeleted) return null;

  return interview;
};

export const toInterviewSummary = (interview: Interview): InterviewSummary => ({
  id: interview.id,
  userId: interview.userId,
  mode: interview.mode,
  domain: interview.domain,
  category: interview.category,
  specification: interview.specification,
  targetRole: interview.targetRole,
  experienceLevel: interview.experienceLevel,
  difficultyLevel: interview.difficultyLevel,
  interviewType: interview.interviewType,
  status: interview.status,
  overallScore: interview.overallScore,
  questionCount: interview.questionCount,
  durationMinutes: interview.durationMinutes,
  createdAt: interview.createdAt,
  completedAt: interview.completedAt,
  updatedAt: interview.updatedAt,
});

export const listInterviewsByUser = async (
  userId: string,
  options: { limit: number; startAfterId?: string }
): Promise<{ items: InterviewSummary[]; hasMore: boolean }> => {
  let query = db
    .collection(COLLECTIONS.INTERVIEWS)
    .where("userId", "==", userId)
    .where("isDeleted", "==", false)
    .orderBy("createdAt", "desc")
    .limit(options.limit + 1);

  if (options.startAfterId) {
    const cursorDoc = await db.collection(COLLECTIONS.INTERVIEWS).doc(options.startAfterId).get();
    if (!cursorDoc.exists) {
      throw new AppError(400, "Invalid pagination cursor. Interview not found.");
    }

    const cursorInterview = cursorDoc.data() as Interview;
    if (cursorInterview.userId !== userId || cursorInterview.isDeleted) {
      throw new AppError(400, "Invalid pagination cursor.");
    }

    query = query.startAfter(cursorDoc);
  }

  const snapshot = await query.get();
  const hasMore = snapshot.docs.length > options.limit;
  const pageDocs = hasMore ? snapshot.docs.slice(0, options.limit) : snapshot.docs;

  return {
    items: pageDocs.map((doc) => toInterviewSummary(doc.data() as Interview)),
    hasMore,
  };
};

export const requireInterview = async (interviewId: string): Promise<Interview> => {
  const interview = await findInterviewById(interviewId);
  if (!interview) throw new AppError(404, "Interview not found. Please check the interview ID.");
  return interview;
};

export const requireOwnedInterview = async (
  interviewId: string,
  userId: string
): Promise<Interview> => {
  const interview = await requireInterview(interviewId);
  if (interview.userId !== userId) {
    throw new AppError(403, "You do not have permission to access this interview.");
  }
  return interview;
};

export const updateInterview = async (
  interviewId: string,
  fields: Partial<Omit<Interview, "id" | "userId" | "createdAt">>
): Promise<Interview> => {
  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId);
  await ref.update({ ...fields, updatedAt: FieldValue.serverTimestamp() });
  return (await ref.get()).data() as Interview;
};

export const setInterviewQuestions = async (
  interviewId: string,
  rawQuestions: RawQuestion[],
  difficultyLevel: DifficultyLevel,
  config?: {
    interviewType: InterviewType;
    durationMinutes: number;
    questionCount: number;
  }
): Promise<InterviewQuestion[]> => {
  const difficulty = toQuestionDifficulty(difficultyLevel);
  const questions: InterviewQuestion[] = rawQuestions.map((rq) => ({
    id: uuidv4(),
    question: rq.question,
    difficulty,
  }));

  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId);
  await ref.update({
    questions,
    questionCount: questions.length,
    difficultyLevel,
    ...(config && {
      interviewType: config.interviewType,
      durationMinutes: config.durationMinutes,
    }),
    status: InterviewStatus.DRAFT,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return questions;
};

export const applyAnswerEvaluations = async (
  interviewId: string,
  answerUpdates: Array<{
    questionId: string;
    answer: string;
    score: number;
    feedback: string;
    answeredAt: Timestamp;
  }>,
  overallScore: number
): Promise<Interview> => {
  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, "Interview not found. Please check the interview ID.");

    const interview = snap.data() as Interview;
    const updateById = new Map(answerUpdates.map((u) => [u.questionId, u]));

    const questions = interview.questions.map((q) => {
      const update = updateById.get(q.id);
      if (!update) return q;

      return {
        ...q,
        answer: update.answer,
        score: update.score,
        feedback: update.feedback,
        answeredAt: update.answeredAt,
      };
    });

    tx.update(ref, {
      questions,
      overallScore,
      status: InterviewStatus.STARTED,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { ...interview, questions, overallScore, status: InterviewStatus.STARTED };
  });
};

/** Returns an existing report, or "proceed" when this caller should generate one. */
export const claimReportGeneration = async (
  interviewId: string
): Promise<InterviewReport | "proceed"> => {
  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, "Interview not found. Please check the interview ID.");

    const interview = snap.data() as Interview;

    if (interview.report?.generatedAt) {
      return interview.report;
    }

    if (interview.reportGenerating) {
      throw new AppError(
        409,
        "Report generation is already in progress for this interview. Please wait and try again."
      );
    }

    tx.update(ref, {
      reportGenerating: true,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return "proceed";
  });
};

export const releaseReportGeneration = async (interviewId: string): Promise<void> => {
  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId);
  await ref.update({
    reportGenerating: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
};

export const completeInterview = async (
  interviewId: string,
  report: InterviewReport,
  overallScore: number
): Promise<Interview> => {
  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId);

  await ref.update({
    report,
    overallScore,
    status: InterviewStatus.COMPLETED,
    completedAt: FieldValue.serverTimestamp(),
    reportGenerating: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return (await ref.get()).data() as Interview;
};

export const softDeleteInterview = async (interviewId: string): Promise<void> => {
  await updateInterview(interviewId, { isDeleted: true });
};
