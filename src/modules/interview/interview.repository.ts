import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase";
import { COLLECTIONS } from "../../shared/constants";
import { AppError } from "../../shared/utils";
import type {
  Answer,
  CreateInterviewInput,
  Evaluation,
  Interview,
  InterviewStatus,
  ListInterviewsQuery,
  PaginatedResult,
  Question,
  RawEvaluation,
  RawQuestion,
  RawReport,
  Report,
} from "./interview.types";
import { QuestionDifficulty } from "./interview.types";

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

  const snap = await db
    .collection(COLLECTIONS.INTERVIEWS)
    .where("userId", "==", userId)
    .get();

  let interviews = snap.docs.map((d) => d.data() as Interview);

  if (status) {
    interviews = interviews.filter((i) => i.status === status);
  }

  interviews.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());

  const total = interviews.length;

  return {
    data: interviews.slice(offset, offset + limit),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
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
    .get();

  return snap.docs
    .map((d) => d.data() as Question)
    .sort((a, b) => a.order - b.order);
};

export const findQuestionById = async (questionId: string): Promise<Question | null> => {
  const snap = await db.collection(COLLECTIONS.QUESTIONS).doc(questionId).get();
  return snap.exists ? (snap.data() as Question) : null;
};

export const saveAnswer = async (
  interviewId: string,
  questionId: string,
  userId: string,
  answerText: string
): Promise<Answer> => {
  const ref = db.collection(COLLECTIONS.ANSWERS).doc();

  await ref.set({
    id: ref.id,
    interviewId,
    questionId,
    userId,
    answer: answerText,
    submittedAt: FieldValue.serverTimestamp(),
  });

  return (await ref.get()).data() as Answer;
};

export const getAnswersByInterview = async (interviewId: string): Promise<Answer[]> => {
  const snap = await db
    .collection(COLLECTIONS.ANSWERS)
    .where("interviewId", "==", interviewId)
    .get();

  return snap.docs.map((d) => d.data() as Answer);
};

export const hasAnswerForQuestion = async (
  interviewId: string,
  questionId: string
): Promise<boolean> => {
  const snap = await db
    .collection(COLLECTIONS.ANSWERS)
    .where("interviewId", "==", interviewId)
    .where("questionId", "==", questionId)
    .limit(1)
    .get();

  return !snap.empty;
};

export const saveEvaluation = async (
  interviewId: string,
  questionId: string,
  answerId: string,
  userId: string,
  raw: RawEvaluation
): Promise<Evaluation> => {
  const ref = db.collection(COLLECTIONS.EVALUATIONS).doc();

  await ref.set({
    id: ref.id,
    interviewId,
    questionId,
    answerId,
    userId,
    technical: raw.technical,
    communication: raw.communication,
    completeness: raw.completeness,
    confidence: raw.confidence,
    feedback: raw.feedback,
    createdAt: FieldValue.serverTimestamp(),
  });

  return (await ref.get()).data() as Evaluation;
};

export const getEvaluationsByInterview = async (interviewId: string): Promise<Evaluation[]> => {
  const snap = await db
    .collection(COLLECTIONS.EVALUATIONS)
    .where("interviewId", "==", interviewId)
    .get();

  return snap.docs.map((d) => d.data() as Evaluation);
};

export const saveReport = async (
  interviewId: string,
  userId: string,
  raw: RawReport
): Promise<Report> => {
  const ref = db.collection(COLLECTIONS.REPORTS).doc();

  await ref.set({
    id: ref.id,
    interviewId,
    userId,
    overallScore: raw.overallScore,
    strengths: raw.strengths,
    weaknesses: raw.weaknesses,
    recommendations: raw.recommendations,
    createdAt: FieldValue.serverTimestamp(),
  });

  return (await ref.get()).data() as Report;
};

export const getReportByInterview = async (interviewId: string): Promise<Report | null> => {
  const snap = await db
    .collection(COLLECTIONS.REPORTS)
    .where("interviewId", "==", interviewId)
    .limit(1)
    .get();

  return snap.empty ? null : (snap.docs[0].data() as Report);
};
