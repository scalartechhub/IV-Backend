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
  InterviewConversationMessage,
  InterviewQuestion,
  InterviewReport,
  InterviewSummary,
  InterviewTotalScore,
  LiveTurnCommitResult,
  RawQuestion,
  DifficultyLevel,
  InterviewType,
} from "./interview.types";
import { InterviewStatus, QuestionDifficulty, toQuestionDifficulty } from "./interview.types";
import { InterviewMode } from "./interview.types";

/** Soft ceiling to keep interviews/{id} under Firestore's 1 MiB document limit. */
const MAX_CONVERSATION_MESSAGES = 120;
const MAX_MESSAGE_CHARS = 8_000;
const MAX_LIVE_DOCUMENT_BYTES = 850_000;

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
  questionCount: interview.questions?.length ?? interview.questionCount ?? 0,
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

const clampMessage = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length > MAX_MESSAGE_CHARS) {
    throw new AppError(413, `Live interview messages cannot exceed ${MAX_MESSAGE_CHARS} characters.`);
  }
  return trimmed;
};

const timestampMs = (value?: Timestamp | null): number | null => {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  return null;
};

export const computeRemainingSeconds = (
  interview: Pick<Interview, "startedAt" | "durationMinutes" | "remainingSeconds">,
  nowMs = Date.now()
): number => {
  const durationSeconds =
    typeof interview.durationMinutes === "number" && interview.durationMinutes > 0
      ? Math.floor(interview.durationMinutes * 60)
      : 45 * 60;

  const startedMs = timestampMs(interview.startedAt ?? null);
  if (startedMs != null) {
    const elapsed = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
    return Math.max(0, durationSeconds - elapsed);
  }

  if (typeof interview.remainingSeconds === "number" && interview.remainingSeconds >= 0) {
    return Math.floor(interview.remainingSeconds);
  }

  return durationSeconds;
};

const resolveCurrentTopic = (interview: Interview): string =>
  interview.specification?.trim() ||
  interview.category?.trim() ||
  interview.domain?.trim() ||
  interview.targetRole?.trim() ||
  "General";

const resolveCurrentDifficulty = (interview: Interview): QuestionDifficulty =>
  interview.difficultyLevel
    ? toQuestionDifficulty(interview.difficultyLevel)
    : QuestionDifficulty.MEDIUM;

const findConversationMessage = (
  conversation: InterviewConversationMessage[],
  predicate: (message: InterviewConversationMessage) => boolean
): InterviewConversationMessage | undefined => conversation.find(predicate);

const assertLiveStateFitsDocument = (
  conversation: InterviewConversationMessage[],
  questions: InterviewQuestion[]
): void => {
  const estimatedBytes = Buffer.byteLength(JSON.stringify({ conversation, questions }), "utf8");
  if (
    conversation.length > MAX_CONVERSATION_MESSAGES ||
    estimatedBytes > MAX_LIVE_DOCUMENT_BYTES
  ) {
    throw new AppError(
      409,
      "This interview has reached its transcript storage limit. Please finish the interview."
    );
  }
};

/**
 * Marks draft → started once and sets timer fields. Idempotent if already started.
 * Separate from conversational turn writes (allowed for start lifecycle).
 */
export const markInterviewStarted = async (interviewId: string): Promise<{
  interview: Interview;
  created: boolean;
}> => {
  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, "Interview not found. Please check the interview ID.");

    const interview = snap.data() as Interview;
    if (interview.status === InterviewStatus.COMPLETED) {
      throw new AppError(400, "This interview is already completed.");
    }
    if (interview.status === InterviewStatus.CANCELLED) {
      throw new AppError(400, "This interview was cancelled and cannot be continued.");
    }

    if (interview.status === InterviewStatus.STARTED && interview.startedAt) {
      return { interview, created: false };
    }

    const now = Timestamp.now();
    const remainingSeconds = computeRemainingSeconds(
      {
        startedAt: now,
        durationMinutes: interview.durationMinutes,
      },
      now.toMillis()
    );

    const patch: Partial<Interview> = {
      status: InterviewStatus.STARTED,
      startedAt: now,
      remainingSeconds,
      currentQuestionIndex: interview.currentQuestionIndex ?? -1,
      conversation: interview.conversation ?? [],
    };

    tx.update(ref, {
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      interview: { ...interview, ...patch, updatedAt: now },
      created: true,
    };
  });
};

/**
 * Exactly one Firestore write for a finalized AI question.
 * Idempotent by message id / questionId / identical trailing assistant text.
 */
export const appendLiveAssistantQuestion = async (
  interviewId: string,
  questionText: string
): Promise<LiveTurnCommitResult> => {
  const messageText = clampMessage(questionText);
  if (!messageText) {
    throw new AppError(400, "AI question text is empty.");
  }

  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId);
  // Generated once per finalized turn, outside the transaction callback, so
  // automatic Firestore transaction retries reuse the same stable ids.
  const questionId = uuidv4();
  const messageId = `m-${questionId}-a`;

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, "Interview not found. Please check the interview ID.");

    const interview = snap.data() as Interview;
    if (interview.status === InterviewStatus.COMPLETED) {
      throw new AppError(400, "This interview is already completed.");
    }
    if (interview.status === InterviewStatus.CANCELLED) {
      throw new AppError(400, "This interview was cancelled.");
    }

    const conversation = [...(interview.conversation ?? [])];
    const last = conversation[conversation.length - 1];
    if (last?.role === "assistant" && last.message === messageText) {
      return { interview, message: last, created: false };
    }

    // Candidate must answer before another AI question is appended (except first question).
    if (last?.role === "assistant") {
      return { interview, message: last, created: false };
    }

    const now = Timestamp.now();
    const existingById = findConversationMessage(conversation, (m) => m.id === messageId);
    if (existingById) {
      return { interview, message: existingById, created: false };
    }

    const difficulty = resolveCurrentDifficulty(interview);
    const topic = resolveCurrentTopic(interview);
    const message: InterviewConversationMessage = {
      id: messageId,
      role: "assistant",
      questionId,
      message: messageText,
      createdAt: now,
    };

    const nextConversation = [...conversation, message];
    const questions = [...(interview.questions ?? [])];
    questions.push({
      id: questionId,
      question: messageText,
      difficulty,
    });
    assertLiveStateFitsDocument(nextConversation, questions);

    const currentQuestionIndex =
      (interview.currentQuestionIndex ?? questions.length - 2) + 1;
    const remainingSeconds = computeRemainingSeconds(
      {
        startedAt: interview.startedAt ?? now,
        durationMinutes: interview.durationMinutes,
      },
      now.toMillis()
    );

    const patch: Partial<Interview> = {
      status: InterviewStatus.STARTED,
      startedAt: interview.startedAt ?? now,
      conversation: nextConversation,
      questions,
      currentQuestionIndex,
      currentQuestionId: questionId,
      lastSpeaker: "assistant",
      currentTopic: topic,
      currentDifficulty: difficulty,
      questionStartTime: now,
      remainingSeconds,
    };

    tx.update(ref, {
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      interview: { ...interview, ...patch, updatedAt: now },
      message,
      created: true,
    };
  });
};

/**
 * Exactly one Firestore write for a finalized candidate answer.
 * Idempotent by questionId candidate message / existing answer on the question.
 */
export const appendLiveCandidateAnswer = async (
  interviewId: string,
  answerText: string,
  preferredQuestionId?: string
): Promise<LiveTurnCommitResult> => {
  const messageText = clampMessage(answerText);
  if (!messageText) {
    throw new AppError(400, "Candidate answer text is empty.");
  }

  const ref = db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError(404, "Interview not found. Please check the interview ID.");

    const interview = snap.data() as Interview;
    if (interview.status === InterviewStatus.COMPLETED) {
      throw new AppError(400, "This interview is already completed.");
    }
    if (interview.status === InterviewStatus.CANCELLED) {
      throw new AppError(400, "This interview was cancelled.");
    }

    const conversation = [...(interview.conversation ?? [])];
    const questions = [...(interview.questions ?? [])];

    const questionId = interview.currentQuestionId;

    if (!questionId) {
      throw new AppError(400, "No active question to answer.");
    }
    if (preferredQuestionId?.trim() && preferredQuestionId.trim() !== questionId) {
      throw new AppError(409, "Candidate answer does not match the active question.");
    }

    const existingCandidate = findConversationMessage(
      conversation,
      (m) => m.role === "candidate" && m.questionId === questionId
    );
    if (existingCandidate) {
      return { interview, message: existingCandidate, created: false };
    }

    const questionIndex = questions.findIndex((q) => q.id === questionId);
    if (questionIndex < 0) {
      throw new AppError(400, "Active question was not found on the interview.");
    }

    const existingQuestion = questions[questionIndex];
    if ((existingQuestion.answer ?? "").trim().length > 0) {
      const synthetic: InterviewConversationMessage = {
        id: `m-${questionId}-c`,
        role: "candidate",
        questionId,
        message: existingQuestion.answer!.trim(),
        createdAt: existingQuestion.answeredAt ?? Timestamp.now(),
      };
      return { interview, message: synthetic, created: false };
    }

    // Only accept an answer when the last finalized speaker is the assistant for this question.
    const last = conversation[conversation.length - 1];
    if (last && !(last.role === "assistant" && last.questionId === questionId)) {
      if (last.role === "candidate" && last.questionId === questionId) {
        return { interview, message: last, created: false };
      }
      throw new AppError(409, "Cannot save candidate answer: interview is not awaiting an answer.");
    }

    const now = Timestamp.now();
    const message: InterviewConversationMessage = {
      id: `m-${questionId}-c`,
      role: "candidate",
      questionId,
      message: messageText,
      createdAt: now,
    };

    const nextConversation = [...conversation, message];
    questions[questionIndex] = {
      ...existingQuestion,
      answer: messageText,
      answeredAt: now,
    };
    assertLiveStateFitsDocument(nextConversation, questions);

    const remainingSeconds = computeRemainingSeconds(
      {
        startedAt: interview.startedAt ?? now,
        durationMinutes: interview.durationMinutes,
      },
      now.toMillis()
    );

    const patch: Partial<Interview> = {
      status: InterviewStatus.STARTED,
      startedAt: interview.startedAt ?? now,
      conversation: nextConversation,
      questions,
      currentQuestionId: questionId,
      currentQuestionIndex:
        typeof interview.currentQuestionIndex === "number"
          ? interview.currentQuestionIndex
          : Math.max(0, questionIndex),
      lastSpeaker: "candidate",
      remainingSeconds,
      currentTopic: interview.currentTopic ?? resolveCurrentTopic(interview),
      currentDifficulty: interview.currentDifficulty ?? resolveCurrentDifficulty(interview),
    };

    tx.update(ref, {
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      interview: { ...interview, ...patch, updatedAt: now },
      message,
      created: true,
    };
  });
};
