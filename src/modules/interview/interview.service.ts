import { Timestamp } from "firebase-admin/firestore";
import * as repo from "./interview.repository";
import { parseResume } from "../ai/resume-parser.service";
import { parseJD } from "../ai/jd-parser.service";
import { generateQuestions } from "../ai/question-generator.service";
import { evaluateAnswersBatch } from "../ai/evaluation.service";
import { generateReport } from "../ai/report.service";
import { uploadFile } from "../storage/storage.service";
import { getUserInterviewSettings, getUserNotificationPreferences } from "../auth/auth.repository";
import { createNotification } from "../notification/notification.repository";
import { AppError } from "../../shared/utils";
import { logger } from "../../shared/logger";
import { DEFAULT_QUESTION_COUNT } from "../../shared/constants";
import type {
  CreateInterviewInput,
  Interview,
  InterviewQuestion,
  InterviewReport,
  FinishInterviewResult,
  SubmitAnswersInput,
  SubmitAnswersResult,
  RawEvaluation,
} from "./interview.types";
import { InterviewCreationMode, InterviewStatus } from "./interview.types";
import {
  calculateInterviewOverallScore,
  countAnsweredQuestions,
  getRawEvaluationScore,
} from "./interview.scoring";

const getInterviewTechnology = (interview: Interview): string =>
  interview.technology ??
  interview.resumeAnalysis?.skills?.[0] ??
  interview.jdAnalysis?.requiredSkills?.[0] ??
  "Interview";

const getInterviewExperienceLevel = (interview: Interview): string =>
  interview.experienceLevel ??
  interview.resumeAnalysis?.experience?.[0] ??
  interview.jdAnalysis?.experience?.[0] ??
  "Based on resume and job description";

const parseInterviewDocuments = async (
  interviewId: string,
  files: { resumeBuffer?: Buffer; jdBuffer?: Buffer }
) => {
  let resumeAnalysis;
  let jdAnalysis;
  let resumeUrl: string | undefined;
  let jdUrl: string | undefined;

  if (files.resumeBuffer) {
    resumeAnalysis = await parseResume(files.resumeBuffer);
    try {
      resumeUrl = await uploadFile(interviewId, "resume", files.resumeBuffer);
    } catch (storageError) {
      logger.warn(
        `[interview.service] resume storage upload failed interviewId=${interviewId}`,
        storageError
      );
    }
  }

  if (files.jdBuffer) {
    jdAnalysis = await parseJD(files.jdBuffer);
    try {
      jdUrl = await uploadFile(interviewId, "jd", files.jdBuffer);
    } catch (storageError) {
      logger.warn(
        `[interview.service] JD storage upload failed interviewId=${interviewId}`,
        storageError
      );
    }
  }

  return { resumeAnalysis, jdAnalysis, resumeUrl, jdUrl };
};

export const createInterview = async (
  userId: string,
  input: CreateInterviewInput
): Promise<Interview> => {
  logger.info(`[interview.service] create interview userId=${userId}`, {
    technology: input.technology,
    creationMode: InterviewCreationMode.PAYLOAD,
  });

  const interview = await repo.createInterview(userId, input);

  const notificationPrefs = await getUserNotificationPreferences(userId);
  if (notificationPrefs.interviewReminders) {
  await createNotification({
    userId,
    interviewId: interview.id,
    title: "Interview Created",
    description: "Your interview has been created successfully.",
    type: "interview",
    read: false,
  });
  }

  return interview;
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

  let interview: Interview | undefined;

  try {
    interview = await repo.createInterviewWithDocuments(userId, {});

    const parsed = await parseInterviewDocuments(interview.id, files);

    interview = await repo.updateInterview(interview.id, {
      ...(parsed.resumeUrl && { resumeUrl: parsed.resumeUrl }),
      ...(parsed.jdUrl && { jdUrl: parsed.jdUrl }),
      ...(parsed.resumeAnalysis && { resumeAnalysis: parsed.resumeAnalysis }),
      ...(parsed.jdAnalysis && { jdAnalysis: parsed.jdAnalysis }),
    });

    const notificationPrefs = await getUserNotificationPreferences(userId);
    if (notificationPrefs.interviewReminders) {
    await createNotification({
      userId,
      interviewId: interview.id,
      title: "Interview Created",
      description: "Your interview has been created successfully.",
      type: "interview",
      read: false,
    });
    }
    return interview;
  } catch (error) {
    if (interview?.id) {
      await repo.updateInterview(interview.id, { status: InterviewStatus.CANCELLED });
    }
    throw error;
  }
};

export const generateInterviewQuestions = async (
  userId: string,
  interviewId: string
): Promise<InterviewQuestion[]> => {
  const interview = await repo.requireOwnedInterview(interviewId, userId);

  if (
    interview.status === InterviewStatus.STARTED ||
    interview.status === InterviewStatus.COMPLETED
  ) {
    throw new AppError(
      400,
      "Cannot generate questions because this interview is already in progress or completed."
    );
  }

  const usesDocuments =
    interview.creationMode === InterviewCreationMode.DOCUMENTS ||
    (Boolean(interview.resumeAnalysis || interview.jdAnalysis) &&
      interview.creationMode !== InterviewCreationMode.PAYLOAD &&
      !interview.difficultyLevel);

  const questionConfig = usesDocuments
    ? await getUserInterviewSettings(userId)
    : {
        difficultyLevel: interview.difficultyLevel,
        interviewType: interview.interviewType,
        durationMinutes: interview.durationMinutes,
        questionCount: interview.questionCount,
      };

  if (
    !questionConfig.difficultyLevel ||
    !questionConfig.interviewType ||
    !questionConfig.durationMinutes ||
    !questionConfig.questionCount
  ) {
    throw new AppError(
      400,
      usesDocuments
        ? "Interview settings are missing. Please set difficultyLevel, durationMinutes, interviewType, and questionCount in your user settings."
        : "Interview configuration is incomplete. Please create the interview again with technology, experienceLevel, difficultyLevel, interviewType, durationMinutes, and questionCount."
    );
  }

  if (usesDocuments && !interview.resumeAnalysis && !interview.jdAnalysis) {
    throw new AppError(
      400,
      "Cannot generate questions because no resume or job description was uploaded for this interview."
    );
  }

  logger.info(`[interview.service] generating questions interviewId=${interviewId}`, {
    creationMode: interview.creationMode,
    questionCount: questionConfig.questionCount,
    difficultyLevel: questionConfig.difficultyLevel,
    interviewType: questionConfig.interviewType,
    hasResume: Boolean(interview.resumeAnalysis),
    hasJD: Boolean(interview.jdAnalysis),
  });

  const questionCount = questionConfig.questionCount ?? DEFAULT_QUESTION_COUNT;

  const rawQuestions = await generateQuestions({
    resumeAnalysis: interview.resumeAnalysis,
    jdAnalysis: interview.jdAnalysis,
    documentsOnly: usesDocuments,
    technology: usesDocuments ? undefined : interview.technology,
    experienceLevel: usesDocuments ? undefined : interview.experienceLevel,
    difficultyLevel: questionConfig.difficultyLevel,
    interviewType: questionConfig.interviewType,
    questionCount,
  });

  const questions = await repo.setInterviewQuestions(
    interviewId,
    rawQuestions,
    questionConfig.difficultyLevel,
    {
      interviewType: questionConfig.interviewType,
      durationMinutes: questionConfig.durationMinutes,
      questionCount,
    }
  );

  logger.info(
    `[interview.service] ${questions.length} questions embedded for interviewId=${interviewId}`
  );
  return questions;
};

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
        category: getInterviewTechnology(interview),
      };
    });

    const batchEvaluations = await evaluateAnswersBatch({
      technology: getInterviewTechnology(interview),
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

export const finishInterview = async (
  userId: string,
  interviewId: string,
  input: SubmitAnswersInput
): Promise<FinishInterviewResult> => {
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
      "No questions are available yet. Please generate questions before finishing the interview."
    );
  }

  const submission =
    input.answers.length > 0
      ? await evaluateSubmittedAnswers(interview, input)
      : {
          results: [],
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
      technology: getInterviewTechnology(updatedInterview),
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
