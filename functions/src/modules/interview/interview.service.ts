import { Timestamp } from "firebase-admin/firestore";
import * as repo from "./interview.repository";
import { parseResume } from "../ai/resume-parser.service";
import { parseJD } from "../ai/jd-parser.service";
import { evaluateAnswersBatch } from "../ai/evaluation.service";
import { generateReport } from "../ai/report.service";
import { getUserInterviewSettings, getUserNotificationPreferences, getUserSubscriptionPlan, assertUserCanCreateInterview, incrementTotalInterviews, updateStatsOnInterviewFinish } from "../auth/auth.repository";
import { createNotification } from "../notification/notification.repository";
import { assertActiveSubscription } from "../subscription/subscription.service";
import { AppError } from "../../shared/utils";
import { assertDifficultyAllowedForPlan } from "../../shared/entitlements";
import { logger } from "../../shared/logger";
import type {
  CreateInterviewInput,
  Interview,
  InterviewListResult,
  InterviewReport,
  FinishInterviewResult,
  SubmitAnswersInput,
  SubmitAnswersResult,
  RawEvaluation,
} from "./interview.types";
import { InterviewMode, InterviewStatus } from "./interview.types";
import { buildInterviewDocuments } from "./interview.document";
import {
  calculateInterviewOverallScore,
  countAnsweredQuestions,
  getRawEvaluationScore,
} from "./interview.scoring";

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

  const plan = await getUserSubscriptionPlan(userId);
  assertDifficultyAllowedForPlan(plan, input.difficultyLevel);
  await assertUserCanCreateInterview(userId);

  const interview = await repo.createInterview(userId, input);
  await incrementTotalInterviews(userId);

  const notificationPrefs = await getUserNotificationPreferences(userId);
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

  logger.info(`[interview.service] live-mode interview created interviewId=${interview.id} (questions skipped)`);
  return repo.requireOwnedInterview(interview.id, userId);
};

export const createInterviewWithDocuments = async (
  userId: string,
  files: { resumeBuffer?: Buffer; jdBuffer?: Buffer }
): Promise<Interview> => {
  if (!files.resumeBuffer && !files.jdBuffer) {
    throw new AppError(
      400,
      "Please upload at least one PDF using form-data field \"resume\" and/or \"jd\"."
    );
  }

  logger.info(`[interview.service] create interview with documents userId=${userId}`, {
    hasResume: Boolean(files.resumeBuffer),
    hasJD: Boolean(files.jdBuffer),
  });

  const [plan, interviewSettings] = await Promise.all([
    getUserSubscriptionPlan(userId),
    getUserInterviewSettings(userId),
  ]);
  assertDifficultyAllowedForPlan(plan, interviewSettings.difficultyLevel);
  await assertUserCanCreateInterview(userId);

  let interview: Interview | undefined;

  try {
    interview = await repo.createInterviewWithDocuments(userId, interviewSettings);
    await incrementTotalInterviews(userId);

    const parsed = await parseInterviewDocuments(files);

    interview = await repo.updateInterview(interview.id, {
      documents: buildInterviewDocuments(parsed),
    });

    const notificationPrefs = await getUserNotificationPreferences(userId);
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

    logger.info(`[interview.service] live-mode interview with documents interviewId=${interview.id} (questions skipped)`);
    return repo.requireOwnedInterview(interview.id, userId);
  } catch (error) {
    if (interview?.id) {
      await repo.updateInterview(interview.id, { status: InterviewStatus.CANCELLED });
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

const EMPTY_ANSWER_EVALUATION: RawEvaluation = {
  technical: 0,
  communication: 0,
  completeness: 0,
  confidence: 0,
  feedback: "No answer provided.",
};

const evaluateSubmittedAnswers = async (
  interview: Interview,
  input: SubmitAnswersInput
): Promise<SubmitAnswersResult> => {
  const questionById = new Map(interview.questions.map((q) => [q.id, q]));

  for (const item of input.answers) {
    if (!questionById.has(item.questionId)) {
      throw new AppError(
        404,
        `Question not found: ${item.questionId}. Make sure you are answering a valid question from this interview.`
      );
    }
  }

  logger.info(
    `[interview.service] evaluating ${input.answers.length} answers interviewId=${interview.id}`
  );

  const answeredItems = input.answers.filter((item) => item.answer.length > 0);
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
  const answerUpdates = input.answers.map((item) => {
    const rawEvaluation =
      item.answer.length > 0
        ? evaluationsByQuestionId.get(item.questionId)!
        : EMPTY_ANSWER_EVALUATION;

    return {
      questionId: item.questionId,
      answer: item.answer,
      score: getRawEvaluationScore(rawEvaluation),
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
      feedback: update.feedback,
      answeredAt: update.answeredAt,
    };
  });

  const overallScore = calculateInterviewOverallScore(mergedQuestions);

  const updatedInterview = await repo.applyAnswerEvaluations(
    interview.id,
    answerUpdates,
    overallScore
  );

  const results: SubmitAnswersResult["results"] = answerUpdates.map((update) => ({
    questionId: update.questionId,
    answer: update.answer,
    score: update.score,
    feedback: update.feedback,
    answeredAt: update.answeredAt,
  }));

  return {
    results,
    overallScore: updatedInterview.overallScore ?? overallScore,
    answeredCount: countAnsweredQuestions(updatedInterview.questions),
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

export const finishInterview = async (
  userId: string,
  interviewId: string
): Promise<FinishInterviewResult> => {
  await assertActiveSubscription(userId);

  const interview = await repo.requireOwnedInterview(interviewId, userId);

  if (interview.status === InterviewStatus.COMPLETED) {
    throw new AppError(400, "This interview is already completed.");
  }
  if (interview.status === InterviewStatus.CANCELLED) {
    throw new AppError(400, "This interview was cancelled and cannot be continued.");
  }
  if (interview.questions.length === 0) {
    throw new AppError(
      400,
      "No interview transcript is available yet. Complete the live session before finishing."
    );
  }

  const answersInput = buildAnswersFromInterview(interview);
  const hasUnevaluatedAnswers = interview.questions.some(
    (q) => (q.answer ?? "").trim().length > 0 && q.score === undefined
  );

  const submission = hasUnevaluatedAnswers
  ? await evaluateSubmittedAnswers(interview, answersInput)
    : {
        results: interview.questions
          .filter((q) => q.score !== undefined)
          .map((q) => ({
            questionId: q.id,
            answer: q.answer ?? "",
            score: q.score!,
            feedback: q.feedback ?? "",
            answeredAt: q.answeredAt ?? Timestamp.now(),
          })),
          overallScore: calculateInterviewOverallScore(interview.questions),
          answeredCount: countAnsweredQuestions(interview.questions),
        };

  const claim = await repo.claimReportGeneration(interviewId);
  if (claim !== "proceed") {
    const updatedInterview = await repo.requireOwnedInterview(interviewId, userId);
    return {
      ...submission,
      report: claim,
    };
  }

  logger.info(`[interview.service] finishing interview interviewId=${interviewId}`);

  try {
    const updatedInterview = await repo.requireOwnedInterview(interviewId, userId);
    const overallScore = calculateInterviewOverallScore(updatedInterview.questions);

    const rawReport = await generateReport({
      technology: getInterviewContextLabel(updatedInterview),
      experienceLevel: getInterviewExperienceLevel(updatedInterview),
      questions: updatedInterview.questions,
    });

    const report: InterviewReport = {
      overallScore: rawReport.overallScore,
      strengths: rawReport.strengths,
      weaknesses: rawReport.weaknesses,
      recommendations: rawReport.recommendations,
      summary: rawReport.summary ?? "Interview completed.",
      generatedAt: Timestamp.now(),
    };

    await repo.completeInterview(interviewId, report, overallScore);

    const analyticsScore = report.overallScore ?? overallScore;
    const targetTechnology =
      updatedInterview.targetRole?.trim() ||
      updatedInterview.specification?.trim() ||
      updatedInterview.category?.trim() ||
      "General";
    const domain = updatedInterview.domain?.trim() || "General";
    const interviewType = updatedInterview.interviewType?.trim() || "technicalInterview";
    const skills = [
      updatedInterview.domain,
      updatedInterview.category,
      updatedInterview.specification,
    ]
      .map((value) => value?.trim() ?? "")
      .filter((value, index, list) => value.length > 0 && list.indexOf(value) === index);

    await updateStatsOnInterviewFinish(userId, analyticsScore, {
      domain,
      interviewType,
      targetTechnology,
      skills,
      interviewDate: Timestamp.now(),
    });

    const notificationPrefs = await getUserNotificationPreferences(userId);
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
      overallScore,
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
): Promise<Interview> => repo.requireOwnedInterview(interviewId, userId);
