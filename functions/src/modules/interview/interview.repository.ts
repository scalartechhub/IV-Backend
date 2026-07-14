import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../config/firebase";
import { COLLECTIONS, INTERVIEW_DOCUMENT_VERSION } from "../../shared/constants";
import { AppError } from "../../shared/utils";
import { decrementMonthlyInterviewCountIfNeeded } from "../auth/auth.repository";
import { calculateInterviewTotalScore } from "./interview.scoring";
import type {
  CreateInterviewInput,
  Interview,
  InterviewQuestion,
  InterviewReport,
  InterviewSummary,
  InterviewTotalScore,
  RawQuestion,
  DifficultyLevel,
  InterviewType,
} from "./interview.types";
import { InterviewStatus, toQuestionDifficulty } from "./interview.types";
import { InterviewMode } from "./interview.types";

export type ClaimReportResult =
  | { status: "existing"; report: InterviewReport; interview: Interview }
  | { status: "proceed"; interview: Interview };

export const createInterview = async (
  userId: string,
  input: CreateInterviewInput
): Promise<Interview> => {
  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc();
  const now = Timestamp.now();

  const interview: Interview = {
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
  };

  await ref.set({
    ...interview,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return interview;
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
  const now = Timestamp.now();

  const interview: Interview = {
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
  };

  await ref.set({
    ...interview,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return interview;
};

export const findInterviewById = async (interviewId: string): Promise<Interview | null> => {
  const snap = await db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId).get();
  if (!snap.exists) return null;

  const interview = snap.data() as Interview & { totalScore?: InterviewTotalScore };
  if (interview.isDeleted) return null;

  // totalScore is not persisted; drop any legacy field and compute from questions when needed.
  const { totalScore: _legacy, ...rest } = interview;
  return rest;
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
  totalScore: calculateInterviewTotalScore(interview.questions ?? []),
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
  fields: Partial<Omit<Interview, "id" | "userId" | "createdAt">>,
  current?: Interview
): Promise<Interview> => {
  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId);
  const updatedAt = Timestamp.now();
  await ref.update({ ...fields, updatedAt: FieldValue.serverTimestamp() });

  if (current) {
    return { ...current, ...fields, updatedAt };
  }

  const snap = await ref.get();
  return snap.data() as Interview;
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
  }>
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
      // totalScore is derived from questions — do not store on the interview doc.
      totalScore: FieldValue.delete(),
      status: InterviewStatus.STARTED,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const { totalScore: _removed, ...rest } = interview;
    return { ...rest, questions, status: InterviewStatus.STARTED };
  });
};

/** Returns an existing report, or signals that this caller should generate one. */
export const claimReportGeneration = async (
  interviewId: string
): Promise<ClaimReportResult> => {
  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, "Interview not found. Please check the interview ID.");

    const interview = snap.data() as Interview;

    if (interview.report?.generatedAt) {
      return { status: "existing" as const, report: interview.report, interview };
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

    return {
      status: "proceed" as const,
      interview: { ...interview, reportGenerating: true },
    };
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
  current?: Interview
): Promise<Interview> => {
  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId);
  const completedAt = Timestamp.now();
  const updatedAt = completedAt;

  await ref.update({
    report,
    // totalScore is derived from questions — do not store on the interview doc.
    totalScore: FieldValue.delete(),
    status: InterviewStatus.COMPLETED,
    completedAt: FieldValue.serverTimestamp(),
    reportGenerating: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (current) {
    const { reportGenerating: _ignored, totalScore: _removed, ...rest } = current;
    return {
      ...rest,
      report,
      status: InterviewStatus.COMPLETED,
      completedAt,
      updatedAt,
    };
  }

  const snap = await ref.get();
  const data = snap.data() as Interview;
  const { totalScore: _removed, ...rest } = data;
  return rest;
};

export const softDeleteInterview = async (interviewId: string): Promise<void> => {
  const interview = await requireInterview(interviewId);
  await updateInterview(interviewId, { isDeleted: true }, interview);
  await decrementMonthlyInterviewCountIfNeeded(interview.userId, interview.createdAt);
};
