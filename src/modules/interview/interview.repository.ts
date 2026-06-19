import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase";
import { COLLECTIONS } from "../../shared/constants";
import { toAnswerDocId, toEvaluationDocId, toReportDocId } from "../../shared/firestore-ids";
import { AppError } from "../../shared/utils";
import type {
  Answer,
  CreateInterviewInput,
  Evaluation,
  Interview,
  ListInterviewsQuery,
  PaginatedResult,
  Question,
  RawEvaluation,
  RawQuestion,
  RawReport,
  Report,
  SubmitAnswerResult,
} from "./interview.types";
import { InterviewStatus, QuestionDifficulty } from "./interview.types";

type PendingDoc = { pending?: boolean };

const findLegacyReport = async (interviewId: string): Promise<Report | null> => {
  const snap = await db
    .collection(COLLECTIONS.REPORTS)
    .where("interviewId", "==", interviewId)
    .limit(1)
    .get();

  if (snap.empty) return null;

  const data = snap.docs[0].data() as Report & PendingDoc;
  if (data.pending) return null;

  return data;
};

export const createInterview = async (
  userId: string,
  input: CreateInterviewInput
): Promise<Interview> => {
  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc();
  const now = FieldValue.serverTimestamp();

  await ref.set({
    id: ref.id,
    userId,
    role: input.role,
    experience: input.experience,
    type: input.type,
    status: "draft",
    totalQuestions: 0,
    answeredQuestions: 0,
    createdAt: now,
    updatedAt: now,
  });

  return (await ref.get()).data() as Interview;
};

export const findInterviewById = async (interviewId: string): Promise<Interview | null> => {
  const snap = await db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId).get();
  return snap.exists ? (snap.data() as Interview) : null;
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
): Promise<PaginatedResult<Interview>> => {
  const { page, limit, status } = params;
  const offset = (page - 1) * limit;

  let query = db
    .collection(COLLECTIONS.INTERVIEWS)
    .where("userId", "==", userId) as FirebaseFirestore.Query;

  if (status) {
    query = query.where("status", "==", status);
  }

  query = query.orderBy("createdAt", "desc");

  const [countSnap, pageSnap] = await Promise.all([
    query.count().get(),
    query.offset(offset).limit(limit).get(),
  ]);

  const total = countSnap.data().count;
  const data = pageSnap.docs.map((d) => d.data() as Interview);

  return {
    data,
    total,
    page,
    limit,
    totalPages: total > 0 ? Math.ceil(total / limit) : 0,
  };
};

export const deleteQuestionsByInterview = async (interviewId: string): Promise<void> => {
  const snap = await db
    .collection(COLLECTIONS.QUESTIONS)
    .where("interviewId", "==", interviewId)
    .get();

  if (snap.empty) return;

  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
};

export const saveQuestions = async (
  interviewId: string,
  userId: string,
  rawQuestions: RawQuestion[]
): Promise<Question[]> => {
  const batch = db.batch();
  const questions: Question[] = [];

  rawQuestions.forEach((rq, index) => {
    const ref = db.collection(COLLECTIONS.QUESTIONS).doc();
    const question: Omit<Question, "createdAt"> & {
      createdAt: ReturnType<typeof FieldValue.serverTimestamp>;
    } = {
      id: ref.id,
      interviewId,
      userId,
      question: rq.question,
      difficulty: (rq.difficulty as QuestionDifficulty) ?? QuestionDifficulty.MEDIUM,
      category: rq.category ?? "General",
      order: index + 1,
      createdAt: FieldValue.serverTimestamp(),
    };
    batch.set(ref, question);
    questions.push(question as unknown as Question);
  });

  await batch.commit();
  return questions;
};

export const getQuestionsByInterview = async (interviewId: string): Promise<Question[]> => {
  const snap = await db
    .collection(COLLECTIONS.QUESTIONS)
    .where("interviewId", "==", interviewId)
    .orderBy("order", "asc")
    .get();

  return snap.docs.map((d) => d.data() as Question);
};

export const findQuestionById = async (questionId: string): Promise<Question | null> => {
  const snap = await db.collection(COLLECTIONS.QUESTIONS).doc(questionId).get();
  return snap.exists ? (snap.data() as Question) : null;
};

/** Atomically reserve an answer slot before AI evaluation (prevents duplicate submissions). */
export const claimAnswerSlot = async (
  interviewId: string,
  questionId: string,
  userId: string
): Promise<void> => {
  const answerRef = db.collection(COLLECTIONS.ANSWERS).doc(toAnswerDocId(interviewId, questionId));

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(answerRef);
    if (snap.exists) {
      const data = snap.data() as PendingDoc;
      if (data.pending) {
        throw new AppError(409, "Answer submission already in progress for this question.");
      }
      throw new AppError(409, "Answer already submitted for this question.");
    }

    tx.set(answerRef, {
      id: answerRef.id,
      interviewId,
      questionId,
      userId,
      answer: "",
      pending: true,
      submittedAt: FieldValue.serverTimestamp(),
    });
  });
};

/** Remove a pending answer reservation after a failed AI evaluation or write. */
export const releaseAnswerSlot = async (
  interviewId: string,
  questionId: string
): Promise<void> => {
  const answerRef = db.collection(COLLECTIONS.ANSWERS).doc(toAnswerDocId(interviewId, questionId));
  const snap = await answerRef.get();
  if (snap.exists && (snap.data() as PendingDoc).pending) {
    await answerRef.delete();
  }
};

export const completeAnswerWithEvaluation = async (
  interviewId: string,
  questionId: string,
  userId: string,
  answerText: string,
  rawEvaluation: RawEvaluation,
  interviewUpdate: Partial<Omit<Interview, "id" | "userId" | "createdAt">>
): Promise<SubmitAnswerResult> => {
  const answerId = toAnswerDocId(interviewId, questionId);
  const answerRef = db.collection(COLLECTIONS.ANSWERS).doc(answerId);
  const evalRef = db.collection(COLLECTIONS.EVALUATIONS).doc(
    toEvaluationDocId(interviewId, questionId)
  );
  const interviewRef = db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId);

  const batch = db.batch();

  batch.update(answerRef, {
    answer: answerText,
    pending: FieldValue.delete(),
    submittedAt: FieldValue.serverTimestamp(),
  });

  batch.set(evalRef, {
    id: evalRef.id,
    interviewId,
    questionId,
    answerId,
    userId,
    technical: rawEvaluation.technical,
    communication: rawEvaluation.communication,
    completeness: rawEvaluation.completeness,
    confidence: rawEvaluation.confidence,
    feedback: rawEvaluation.feedback,
    createdAt: FieldValue.serverTimestamp(),
  });

  batch.update(interviewRef, {
    ...interviewUpdate,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  const [answerSnap, evalSnap] = await Promise.all([answerRef.get(), evalRef.get()]);

  return {
    answer: answerSnap.data() as Answer,
    evaluation: evalSnap.data() as Evaluation,
  };
};

export const saveAnswer = async (
  interviewId: string,
  questionId: string,
  userId: string,
  answerText: string
): Promise<Answer> => {
  const answerId = toAnswerDocId(interviewId, questionId);
  const answerRef = db.collection(COLLECTIONS.ANSWERS).doc(answerId);

  const existing = await answerRef.get();
  if (existing.exists && !(existing.data() as PendingDoc).pending) {
    throw new AppError(409, `Answer already submitted for question ${questionId}.`);
  }

  await answerRef.set({
    id: answerId,
    interviewId,
    questionId,
    userId,
    answer: answerText,
    submittedAt: FieldValue.serverTimestamp(),
  });

  return (await answerRef.get()).data() as Answer;
};

export const saveEvaluation = async (
  interviewId: string,
  questionId: string,
  answerId: string,
  userId: string,
  rawEvaluation: RawEvaluation
): Promise<Evaluation> => {
  const evalRef = db
    .collection(COLLECTIONS.EVALUATIONS)
    .doc(toEvaluationDocId(interviewId, questionId));

  await evalRef.set({
    id: evalRef.id,
    interviewId,
    questionId,
    answerId,
    userId,
    technical: rawEvaluation.technical,
    communication: rawEvaluation.communication,
    completeness: rawEvaluation.completeness,
    confidence: rawEvaluation.confidence,
    feedback: rawEvaluation.feedback,
    createdAt: FieldValue.serverTimestamp(),
  });

  return (await evalRef.get()).data() as Evaluation;
};

export const getAnswersByInterview = async (interviewId: string): Promise<Answer[]> => {
  const snap = await db
    .collection(COLLECTIONS.ANSWERS)
    .where("interviewId", "==", interviewId)
    .get();

  return snap.docs
    .map((d) => d.data() as Answer & PendingDoc)
    .filter((a) => !a.pending);
};

export const getEvaluationsByInterview = async (interviewId: string): Promise<Evaluation[]> => {
  const snap = await db
    .collection(COLLECTIONS.EVALUATIONS)
    .where("interviewId", "==", interviewId)
    .get();

  return snap.docs.map((d) => d.data() as Evaluation);
};

/** Returns an existing report, or "proceed" when this caller should generate one. */
export const claimReportGeneration = async (
  interviewId: string,
  userId: string
): Promise<Report | "proceed"> => {
  const reportRef = db.collection(COLLECTIONS.REPORTS).doc(toReportDocId(interviewId));
  const existingSnap = await reportRef.get();

  if (existingSnap.exists) {
    const data = existingSnap.data() as Report & PendingDoc;
    if (data.pending) {
      throw new AppError(409, "Report generation already in progress.");
    }
    return data;
  }

  const legacyReport = await findLegacyReport(interviewId);
  if (legacyReport) return legacyReport;

  return db.runTransaction(async (tx) => {
    const reportSnap = await tx.get(reportRef);
    if (reportSnap.exists) {
      const data = reportSnap.data() as Report & PendingDoc;
      if (data.pending) {
        throw new AppError(409, "Report generation already in progress.");
      }
      return data;
    }

    tx.set(reportRef, {
      id: reportRef.id,
      interviewId,
      userId,
      pending: true,
      overallScore: 0,
      strengths: [],
      weaknesses: [],
      recommendations: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    return "proceed";
  });
};

export const releaseReportGeneration = async (interviewId: string): Promise<void> => {
  const reportRef = db.collection(COLLECTIONS.REPORTS).doc(toReportDocId(interviewId));
  const snap = await reportRef.get();
  if (snap.exists && (snap.data() as PendingDoc).pending) {
    await reportRef.delete();
  }
};

export const completeReport = async (
  interviewId: string,
  userId: string,
  raw: RawReport,
  overallPerformance: number
): Promise<Report> => {
  const reportRef = db.collection(COLLECTIONS.REPORTS).doc(toReportDocId(interviewId));
  const interviewRef = db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId);

  const batch = db.batch();

  batch.set(reportRef, {
    id: reportRef.id,
    interviewId,
    userId,
    overallScore: raw.overallScore,
    strengths: raw.strengths,
    weaknesses: raw.weaknesses,
    recommendations: raw.recommendations,
    pending: FieldValue.delete(),
    createdAt: FieldValue.serverTimestamp(),
  });

  batch.update(interviewRef, {
    status: InterviewStatus.COMPLETED,
    overallPerformance,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return (await reportRef.get()).data() as Report;
};

export const getReportByInterview = async (interviewId: string): Promise<Report | null> => {
  const snap = await db.collection(COLLECTIONS.REPORTS).doc(toReportDocId(interviewId)).get();
  if (snap.exists) {
    const data = snap.data() as Report & PendingDoc;
    if (!data.pending) return data;
    return null;
  }

  return findLegacyReport(interviewId);
};
