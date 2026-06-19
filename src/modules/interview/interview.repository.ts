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
  ListInterviewsQuery,
  PaginatedResult,
  RawQuestion,
} from "./interview.types";
import { InterviewStatus, QuestionDifficulty } from "./interview.types";

const toInterviewSummary = (interview: Interview): InterviewSummary => ({
  id: interview.id,
  userId: interview.userId,
  technology: interview.technology,
  experienceLevel: interview.experienceLevel,
  interviewType: interview.interviewType,
  status: interview.status,
  overallScore: interview.overallScore,
  questionCount: interview.questionCount,
  answeredCount: interview.questions.filter((q) => Boolean(q.answer)).length,
  createdAt: interview.createdAt,
  completedAt: interview.completedAt,
});

export const createInterview = async (
  userId: string,
  input: CreateInterviewInput
): Promise<Interview> => {
  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc();
  const now = FieldValue.serverTimestamp();

  await ref.set({
    id: ref.id,
    userId,
    technology: input.technology,
    experienceLevel: input.experienceLevel,
    interviewType: input.interviewType,
    status: InterviewStatus.DRAFT,
    questionCount: 0,
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

export const requireInterview = async (interviewId: string): Promise<Interview> => {
  const interview = await findInterviewById(interviewId);
  if (!interview) throw new AppError(404, "Interview not found");
  return interview;
};

export const requireOwnedInterview = async (
  interviewId: string,
  userId: string
): Promise<Interview> => {
  const interview = await requireInterview(interviewId);
  if (interview.userId !== userId) throw new AppError(403, "Access denied");
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

export const listInterviewsByUser = async (
  userId: string,
  params: ListInterviewsQuery
): Promise<PaginatedResult<InterviewSummary>> => {
  const { page, limit, status } = params;
  const offset = (page - 1) * limit;

  let query = db
    .collection(COLLECTIONS.INTERVIEWS)
    .where("userId", "==", userId)
    .where("isDeleted", "==", false) as FirebaseFirestore.Query;

  if (status) {
    query = query.where("status", "==", status);
  }

  query = query.orderBy("createdAt", "desc");

  const [countSnap, pageSnap] = await Promise.all([
    query.count().get(),
    query.offset(offset).limit(limit).get(),
  ]);

  const total = countSnap.data().count;
  const data = pageSnap.docs.map((d) => toInterviewSummary(d.data() as Interview));

  return {
    data,
    total,
    page,
    limit,
    totalPages: total > 0 ? Math.ceil(total / limit) : 0,
  };
};

export const setInterviewQuestions = async (
  interviewId: string,
  rawQuestions: RawQuestion[]
): Promise<InterviewQuestion[]> => {
  const questions: InterviewQuestion[] = rawQuestions.map((rq) => ({
    id: uuidv4(),
    question: rq.question,
    difficulty: (rq.difficulty as QuestionDifficulty) ?? QuestionDifficulty.MEDIUM,
  }));

  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId);
  await ref.update({
    questions,
    questionCount: questions.length,
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
    if (!snap.exists) throw new AppError(404, "Interview not found");

    const interview = snap.data() as Interview;
    const updateById = new Map(answerUpdates.map((u) => [u.questionId, u]));

    const questions = interview.questions.map((q) => {
      const update = updateById.get(q.id);
      if (!update) return q;

      if (q.answer && q.answer.length > 0) {
        throw new AppError(409, `Answer already submitted for question ${q.id}.`);
      }

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
    if (!snap.exists) throw new AppError(404, "Interview not found");

    const interview = snap.data() as Interview;

    if (interview.report?.generatedAt) {
      return interview.report;
    }

    if (interview.reportGenerating) {
      throw new AppError(409, "Report generation already in progress.");
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
