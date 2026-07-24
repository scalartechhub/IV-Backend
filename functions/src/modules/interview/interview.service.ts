import { Timestamp } from "firebase-admin/firestore";
import * as repo from "./interview.repository";
import { parseResume } from "../ai/resume-parser.service";
import { parseJD } from "../ai/jd-parser.service";
import { evaluateAnswersBatch } from "../ai/evaluation.service";
import { generateReport } from "../ai/report.service";
import {
  requireUserById,
  // subscriptionPlanFromUser,
  interviewSettingsFromUser,
  notificationPreferencesFromUser,
  assertUserCanCreateInterview,
  incrementTotalInterviews,
  updateStatsOnInterviewFinish,
} from "../auth/auth.repository";
import { createNotification } from "../notification/notification.repository";
import {
  assertActiveSubscription,
  assertActiveSubscriptionForUser,
} from "../subscription/subscription.service";
import { AppError } from "../../shared/utils";
// import { assertDifficultyAllowedForPlan } from "../../shared/entitlements";
import { logger } from "../../shared/logger";
import type {
  CreateInterviewInput,
  Interview,
  InterviewListResult,
  InterviewReport,
  InterviewResumeState,
  FinishInterviewResult,
  SubmitAnswersInput,
  SubmitAnswersResult,
  RawEvaluation,
} from "./interview.types";
import { InterviewMode, InterviewStatus } from "./interview.types";
import { buildInterviewDocuments } from "./interview.document";
import {
  calculateDimensionAverages,
  calculateHiringProbability,
  calculateInterviewTotalScore,
  countAnsweredQuestions,
  getRawEvaluationScore,
  resolveOverallScore,
} from "./interview.scoring";
import { awaitLiveSessionPersist } from "../live-interview/live-interview.ws";

const getInterviewContextLabel = (interview: Interview): string => {
  const role = interview.targetRole?.trim();
  const specification = interview.specification?.trim();
  const category = interview.category?.trim();
  const domain = interview.domain?.trim();
  const fallback =
    interview.documents?.resume?.parsed?.skills?.[0] ??
    interview.documents?.jd?.parsed?.requiredSkills?.[0] ??
    "Interview";

  const parts = [role, specification, category, domain].filter(
    (value): value is string => Boolean(value && value.length > 0)
  );
  return parts.length > 0 ? parts.join(" | ") : fallback;
};

const getInterviewExperienceLevel = (interview: Interview): string =>
  interview.experienceLevel ??
  interview.documents?.resume?.parsed?.experience?.[0] ??
  interview.documents?.jd?.parsed?.experience?.[0] ??
  "Based on resume and job description";

const parseInterviewDocuments = async (files: {
  resumeBuffer?: Buffer;
  jdBuffer?: Buffer;
}) => {
  let resumeParsed;
  let jdParsed;

  if (files.resumeBuffer) {
    resumeParsed = await parseResume(files.resumeBuffer);
  }

  if (files.jdBuffer) {
    jdParsed = await parseJD(files.jdBuffer);
  }

  return { resumeParsed, jdParsed };
};

export const createInterview = async (
  userId: string,
  input: CreateInterviewInput
): Promise<Interview> => {
  logger.info(`[interview.service] create interview userId=${userId}`, {
    domain: input.domain,
    category: input.category,
    specification: input.specification,
    targetRole: input.targetRole,
    mode: InterviewMode.PAYLOAD,
  });

  const user = await requireUserById(userId);
  // const plan = subscriptionPlanFromUser(user);
  // assertDifficultyAllowedForPlan(plan, input.difficultyLevel);
  await assertUserCanCreateInterview(userId, user);

  const interview = await repo.createInterview(userId, input);
  await incrementTotalInterviews(userId);

  const notificationPrefs = notificationPreferencesFromUser(user);
  if (notificationPrefs.interviewReminders) {
    await createNotification({
      userId,
      interviewId: interview.id,
      title: "Interview Created",
      description: "Your live interview session is ready.",
      type: "interview",
      read: false,
    });
  }

  logger.info(
    `[interview.service] live-mode interview created interviewId=${interview.id} (questions skipped)`
  );
  return interview;
};

export const createInterviewWithDocuments = async (
  userId: string,
  files: { resumeBuffer?: Buffer; jdBuffer?: Buffer }
): Promise<Interview> => {
  if (!files.resumeBuffer && !files.jdBuffer) {
    throw new AppError(
      400,
      'Please upload at least one PDF using form-data field "resume" and/or "jd".'
    );
  }

  logger.info(`[interview.service] create interview with documents userId=${userId}`, {
    hasResume: Boolean(files.resumeBuffer),
    hasJD: Boolean(files.jdBuffer),
  });

  const user = await requireUserById(userId);
  const interviewSettings = interviewSettingsFromUser(user);
  // const plan = subscriptionPlanFromUser(user);
  // assertDifficultyAllowedForPlan(plan, interviewSettings.difficultyLevel);
  await assertUserCanCreateInterview(userId, user);

  let interview: Interview | undefined;

  try {
    interview = await repo.createInterviewWithDocuments(userId, interviewSettings);
    await incrementTotalInterviews(userId);

    const parsed = await parseInterviewDocuments(files);

    interview = await repo.updateInterview(
      interview.id,
      {
        documents: buildInterviewDocuments(parsed),
      },
      interview
    );

    const notificationPrefs = notificationPreferencesFromUser(user);
    if (notificationPrefs.interviewReminders) {
      await createNotification({
        userId,
        interviewId: interview.id,
        title: "Interview Created",
        description: "Your live interview session is ready.",
        type: "interview",
        read: false,
      });
    }

    logger.info(
      `[interview.service] live-mode interview with documents interviewId=${interview.id} (questions skipped)`
    );
    return interview;
  } catch (error) {
    if (interview?.id) {
      await repo.updateInterview(interview.id, { status: InterviewStatus.CANCELLED }, interview);
    }
    throw error;
  }
};

const buildAnswersFromInterview = (interview: Interview): SubmitAnswersInput => ({
  answers: interview.questions.map((q) => ({
    questionId: q.id,
    answer: (q.answer ?? "").trim(),
  })),
});

const rebuildQuestionsFromConversation = (interview: Interview): Interview["questions"] => {
  const conversation = interview.conversation ?? [];
  if (!conversation.length) return [];

  const byQuestionId = new Map<string, Interview["questions"][number]>();
  const difficulty =
    interview.currentDifficulty ??
    (interview.difficultyLevel
      ? (interview.difficultyLevel as Interview["questions"][number]["difficulty"])
      : ("medium" as Interview["questions"][number]["difficulty"]));

  for (const entry of conversation) {
    const existing: Interview["questions"][number] = byQuestionId.get(entry.questionId) ?? {
      id: entry.questionId,
      question: "",
      difficulty,
    };

    if (entry.role === "assistant") {
      existing.question = entry.message;
    } else {
      existing.answer = entry.message;
      existing.answeredAt = entry.createdAt;
    }

    byQuestionId.set(entry.questionId, existing);
  }

  return [...byQuestionId.values()].filter((q) => q.question.trim().length > 0);
};

const EMPTY_ANSWER_EVALUATION: RawEvaluation = {
  technical: 0,
  communication: 0,
  completeness: 0,
  confidence: 0,
  feedback: "No answer provided.",
};

const buildNoParticipationReport = (): InterviewReport => ({
  overallScore: 0,
  strengths: [],
  weaknesses: ["No answers were recorded during this session."],
  recommendations: [
    "Join the live interview and respond to each question before submitting.",
    "Check your microphone permissions if you intended to answer verbally.",
  ],
  summary: "This interview was submitted without any recorded answers.",
  generatedAt: Timestamp.now(),
});

const evaluateSubmittedAnswers = async (
  interview: Interview,
  input: SubmitAnswersInput
): Promise<{ submission: SubmitAnswersResult; interview: Interview }> => {
  const questionById = new Map(interview.questions.map((q) => [q.id, q]));

  for (const item of input.answers) {
    if (!questionById.has(item.questionId)) {
      throw new AppError(
        404,
        `Question not found: ${item.questionId}. Make sure you are answering a valid question from this interview.`
      );
    }
  }

  const normalizedAnswers = input.answers.map((item) => ({
    ...item,
    answer: item.answer.trim(),
  }));

  logger.info(
    `[interview.service] evaluating ${normalizedAnswers.length} answers interviewId=${interview.id}`
  );

  const answeredItems = normalizedAnswers.filter((item) => item.answer.length > 0);
  const evaluationsByQuestionId = new Map<string, RawEvaluation>();

  if (answeredItems.length > 0) {
    const batchItems = answeredItems.map((item) => {
      const question = questionById.get(item.questionId)!;
      return {
        questionId: item.questionId,
        question: question.question,
        answer: item.answer,
        difficulty: question.difficulty,
        category: getInterviewContextLabel(interview),
      };
    });

    const batchEvaluations = await evaluateAnswersBatch({
      technology: getInterviewContextLabel(interview),
      items: batchItems,
    });

    for (const [questionId, evaluation] of batchEvaluations) {
      evaluationsByQuestionId.set(questionId, evaluation);
    }
  }

  const answeredAt = Timestamp.now();
  const answerUpdates = normalizedAnswers.map((item) => {
    const rawEvaluation =
      item.answer.length > 0
        ? evaluationsByQuestionId.get(item.questionId)!
        : EMPTY_ANSWER_EVALUATION;

    return {
      questionId: item.questionId,
      answer: item.answer,
      score: getRawEvaluationScore(rawEvaluation),
      technicalScore: rawEvaluation.technical,
      communicationScore: rawEvaluation.communication,
      completenessScore: rawEvaluation.completeness,
      confidenceScore: rawEvaluation.confidence,
      feedback: rawEvaluation.feedback,
      answeredAt,
    };
  });

  const mergedQuestions = interview.questions.map((q) => {
    const update = answerUpdates.find((u) => u.questionId === q.id);
    if (!update) return q;
    return {
      ...q,
      answer: update.answer,
      score: update.score,
      technicalScore: update.technicalScore,
      communicationScore: update.communicationScore,
      completenessScore: update.completenessScore,
      confidenceScore: update.confidenceScore,
      feedback: update.feedback,
      answeredAt: update.answeredAt,
    };
  });

  const totalScore = calculateInterviewTotalScore(mergedQuestions);

  const updatedInterview = await repo.applyAnswerEvaluations(
    interview.id,
    answerUpdates
  );

  const results: SubmitAnswersResult["results"] = answerUpdates.map((update) => ({
    questionId: update.questionId,
    answer: update.answer,
    score: update.score,
    feedback: update.feedback,
    answeredAt: update.answeredAt,
  }));

  return {
    submission: {
      results,
      totalScore,
      answeredCount: countAnsweredQuestions(updatedInterview.questions),
    },
    interview: updatedInterview,
  };
};

export const prepareLiveSession = async (
  userId: string,
  interviewId: string
): Promise<Interview> => {
  await assertActiveSubscription(userId);

  const interview = await repo.requireOwnedInterview(interviewId, userId);

  if (interview.status === InterviewStatus.COMPLETED) {
    throw new AppError(400, "This interview is already completed.");
  }
  if (interview.status === InterviewStatus.CANCELLED) {
    throw new AppError(400, "This interview was cancelled and cannot be continued.");
  }

  return interview;
};

export const resumeInterview = async (
  userId: string,
  interviewId: string
): Promise<InterviewResumeState> => {
  await assertActiveSubscription(userId);

  const interview = await repo.requireOwnedInterview(interviewId, userId);

  if (interview.status === InterviewStatus.CANCELLED) {
    throw new AppError(400, "This interview was cancelled and cannot be continued.");
  }

  const remainingSeconds = repo.computeRemainingSeconds(interview);

  return {
    status: interview.status,
    conversation: interview.conversation ?? [],
    currentQuestionIndex:
      typeof interview.currentQuestionIndex === "number" ? interview.currentQuestionIndex : -1,
    lastSpeaker: interview.lastSpeaker,
    currentTopic: interview.currentTopic,
    currentDifficulty: interview.currentDifficulty,
    currentQuestionId: interview.currentQuestionId,
    startedAt: interview.startedAt,
    remainingSeconds,
    questionStartTime: interview.questionStartTime,
  };
};

export const finishInterview = async (
  userId: string,
  interviewId: string
): Promise<FinishInterviewResult> => {
  const user = await requireUserById(userId);
  assertActiveSubscriptionForUser(user);

  await awaitLiveSessionPersist(interviewId);

  let interview = await repo.requireOwnedInterview(interviewId, userId);

  if (interview.status === InterviewStatus.COMPLETED) {
    throw new AppError(400, "This interview is already completed.");
  }
  if (interview.status === InterviewStatus.CANCELLED) {
    throw new AppError(400, "This interview was cancelled and cannot be continued.");
  }

  if (interview.questions.length === 0 && (interview.conversation?.length ?? 0) > 0) {
    const rebuilt = rebuildQuestionsFromConversation(interview);
    if (rebuilt.length > 0) {
      interview = await repo.updateInterview(
        interviewId,
        {
          questions: rebuilt,
        },
        interview
      );
    }
  }

  let submission: SubmitAnswersResult;

  if (interview.questions.length > 0) {
    const answersInput = buildAnswersFromInterview(interview);
    const hasUnevaluatedAnswers = interview.questions.some((q) => q.score === undefined);

    if (hasUnevaluatedAnswers) {
      const evaluated = await evaluateSubmittedAnswers(interview, answersInput);
      submission = evaluated.submission;
      interview = evaluated.interview;
    } else {
      submission = {
        results: interview.questions
          .filter((q) => q.score !== undefined)
          .map((q) => ({
            questionId: q.id,
            answer: q.answer ?? "",
            score: q.score!,
            feedback: q.feedback ?? "",
            answeredAt: q.answeredAt ?? Timestamp.now(),
          })),
        totalScore: calculateInterviewTotalScore(interview.questions),
        answeredCount: countAnsweredQuestions(interview.questions),
      };
    }
  } else {
    submission = {
      results: [],
      totalScore: calculateInterviewTotalScore([]),
      answeredCount: 0,
    };
  }

  const claim = await repo.claimReportGeneration(interviewId);
  if (claim.status === "existing") {
    return {
      ...submission,
      report: claim.report,
    };
  }

  interview = claim.interview;

  logger.info(`[interview.service] finishing interview interviewId=${interviewId}`);

  try {
    const totalScore = calculateInterviewTotalScore(interview.questions);

    let report: InterviewReport;
    if (interview.questions.length === 0) {
      report = buildNoParticipationReport();
    } else {
      const rawReport = await generateReport({
        technology: getInterviewContextLabel(interview),
        experienceLevel: getInterviewExperienceLevel(interview),
        questions: interview.questions,
      });
      report = {
        overallScore: resolveOverallScore(rawReport.overallScore, totalScore),
        strengths: rawReport.strengths,
        weaknesses: rawReport.weaknesses,
        recommendations: rawReport.recommendations,
        summary: rawReport.summary ?? "Interview completed.",
        generatedAt: Timestamp.now(),
      };
    }

    await repo.completeInterview(interviewId, report, interview);

    const analyticsScore = report.overallScore;
    const targetTechnology =
      interview.targetRole?.trim() ||
      interview.specification?.trim() ||
      interview.category?.trim() ||
      "General";
    const domain = interview.domain?.trim() || "General";
    const interviewType = interview.interviewType?.trim() || "technicalInterview";
    const dimensionAverages = calculateDimensionAverages(interview.questions);
    const hiringProbability = calculateHiringProbability(dimensionAverages, analyticsScore);

    await updateStatsOnInterviewFinish(userId, analyticsScore, {
      domain,
      interviewType,
      targetTechnology,
      interviewDate: Timestamp.now(),
      technicalScore: dimensionAverages.technical,
      communicationScore: dimensionAverages.communication,
      completenessScore: dimensionAverages.completeness,
      confidenceScore: dimensionAverages.confidence,
      hiringProbability,
    });

    const notificationPrefs = notificationPreferencesFromUser(user);
    if (notificationPrefs.feedbackReports) {
      await createNotification({
        userId,
        interviewId,
        title: "Interview Report Ready",
        description: "Your interview report has been generated successfully.",
        type: "report",
        actionUrl: `/dashboard/reports/interview/${interviewId}`,
        read: false,
      });
    }

    logger.info(`[interview.service] interview completed interviewId=${interviewId}`, {
      totalScore,
      reportScore: report.overallScore,
    });

    return {
      ...submission,
      report,
    };
  } catch (error) {
    await repo.releaseReportGeneration(interviewId);
    throw error;
  }
};

export const listInterviews = async (
  userId: string,
  options: { limit: number; startAfter?: string }
): Promise<InterviewListResult> => {
  const { items, hasMore } = await repo.listInterviewsByUser(userId, {
    limit: options.limit,
    startAfterId: options.startAfter,
  });

  return {
    items,
    hasMore,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : undefined,
  };
};

export const getInterviewById = async (
  userId: string,
  interviewId: string
): Promise<Interview> => {
  const interview = await repo.requireOwnedInterview(interviewId, userId);
  return {
    ...interview,
    totalScore: calculateInterviewTotalScore(interview.questions ?? []),
  };
};
