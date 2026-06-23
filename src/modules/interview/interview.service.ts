import { Timestamp } from "firebase-admin/firestore";
import * as repo from "./interview.repository";
import { parseResume } from "../ai/resume-parser.service";
import { parseJD } from "../ai/jd-parser.service";
import { generateQuestions } from "../ai/question-generator.service";
import { evaluateAnswersBatch } from "../ai/evaluation.service";
import { generateReport } from "../ai/report.service";
import { uploadFile } from "../storage/storage.service";
import { getUserProfile } from "../auth/auth.repository";
import { userStatsService } from "../auth/user-stats.service";
import { AppError } from "../../shared/utils";
import { logger } from "../../shared/logger";
import { QUESTION_DISTRIBUTION } from "../../shared/constants";
import type {
  CreateInterviewInput,
  Interview,
  InterviewQuestion,
  InterviewReport,
  SubmitAnswersInput,
  SubmitAnswersResult,
} from "./interview.types";
import { InterviewStatus } from "./interview.types";
import {
  calculateInterviewOverallScore,
  countAnsweredQuestions,
  getRawEvaluationScore,
} from "./interview.scoring";

export const createInterview = async (
  userId: string,
  input: CreateInterviewInput
): Promise<Interview> => {
  logger.info(`[interview.service] create interview userId=${userId}`, {
    technology: input.technology,
  });

  const interview = await repo.createInterview(userId, input);
  await userStatsService.onInterviewCreated(userId);

  return interview;
};

export const uploadResume = async (
  userId: string,
  interviewId: string,
  fileBuffer: Buffer
): Promise<Interview> => {
  const interview = await repo.requireOwnedInterview(interviewId, userId);

  logger.info(`[interview.service] uploading resume interviewId=${interviewId}`);

  try {
    const resumeAnalysis = await parseResume(fileBuffer);

    let resumeUrl: string | undefined;
    try {
      resumeUrl = await uploadFile(interviewId, "resume", fileBuffer);
    } catch (storageError) {
      logger.warn(
        `[interview.service] resume storage upload failed interviewId=${interviewId}`,
        storageError
      );
    }

    return repo.updateInterview(interviewId, {
      ...(resumeUrl && { resumeUrl }),
      resumeAnalysis,
    });
  } catch (error) {
    await repo.updateInterview(interviewId, { status: InterviewStatus.CANCELLED });
    throw error;
  }
};

export const uploadJD = async (
  userId: string,
  interviewId: string,
  fileBuffer: Buffer
): Promise<Interview> => {
  const interview = await repo.requireOwnedInterview(interviewId, userId);

  logger.info(`[interview.service] uploading JD interviewId=${interviewId}`);

  try {
    const jdAnalysis = await parseJD(fileBuffer);

    let jdUrl: string | undefined;
    try {
      jdUrl = await uploadFile(interviewId, "jd", fileBuffer);
    } catch (storageError) {
      logger.warn(
        `[interview.service] JD storage upload failed interviewId=${interviewId}`,
        storageError
      );
    }

    return repo.updateInterview(interviewId, {
      ...(jdUrl && { jdUrl }),
      jdAnalysis,
    });
  } catch (error) {
    await repo.updateInterview(interviewId, { status: InterviewStatus.CANCELLED });
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
    throw new AppError(400, "Cannot regenerate questions for an interview already in progress.");
  }

  const userProfile = await getUserProfile(userId);

  logger.info(`[interview.service] generating questions interviewId=${interviewId}`, {
    numberOfQuestions: interview.numberOfQuestions,
    hasResume: Boolean(interview.resumeAnalysis),
    hasJD: Boolean(interview.jdAnalysis),
  });

  const numberOfQuestions =
    interview.numberOfQuestions ?? QUESTION_DISTRIBUTION.TOTAL;

  const rawQuestions = await generateQuestions({
    resumeAnalysis: interview.resumeAnalysis,
    jdAnalysis: interview.jdAnalysis,
    userProfile,
    technology: interview.technology,
    experienceLevel: interview.experienceLevel,
    interviewType: interview.interviewType,
    numberOfQuestions,
  });

  const questions = await repo.setInterviewQuestions(interviewId, rawQuestions);

  logger.info(
    `[interview.service] ${questions.length} questions embedded for interviewId=${interviewId}`
  );
  return questions;
};

export const submitAnswers = async (
  userId: string,
  interviewId: string,
  input: SubmitAnswersInput
): Promise<SubmitAnswersResult> => {
  const interview = await repo.requireOwnedInterview(interviewId, userId);

  if (interview.status === InterviewStatus.COMPLETED) {
    throw new AppError(400, "This interview has already been completed.");
  }
  if (interview.status === InterviewStatus.CANCELLED) {
    throw new AppError(400, "Interview was cancelled.");
  }
  if (interview.questions.length === 0) {
    throw new AppError(400, "No questions found. Please generate questions first.");
  }

  const questionById = new Map(interview.questions.map((q) => [q.id, q]));

  for (const item of input.answers) {
    if (!questionById.has(item.questionId)) {
      throw new AppError(404, `Question not found: ${item.questionId}`);
    }
  }

  logger.info(
    `[interview.service] submitting ${input.answers.length} answers interviewId=${interviewId}`
  );

  const batchItems = input.answers.map((item) => {
    const question = questionById.get(item.questionId)!;
    return {
      questionId: item.questionId,
      question: question.question,
      answer: item.answer,
      difficulty: question.difficulty,
      category: interview.technology,
    };
  });

  const evaluationsByQuestionId = await evaluateAnswersBatch({
    technology: interview.technology,
    items: batchItems,
  });

  const answeredAt = Timestamp.now();
  const answerUpdates = input.answers.map((item) => {
    const rawEvaluation = evaluationsByQuestionId.get(item.questionId)!;
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
    interviewId,
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
  interviewId: string
): Promise<InterviewReport> => {
  const interview = await repo.requireOwnedInterview(interviewId, userId);

  if (interview.status === InterviewStatus.CANCELLED) {
    throw new AppError(400, "Interview was cancelled.");
  }

  const answeredCount = countAnsweredQuestions(interview.questions);
  if (answeredCount === 0) {
    throw new AppError(
      400,
      "No answers submitted yet. Answer at least one question before finishing."
    );
  }

  const claim = await repo.claimReportGeneration(interviewId);
  if (claim !== "proceed") {
    return claim;
  }

  logger.info(`[interview.service] finishing interview interviewId=${interviewId}`);

  try {
    const overallScore = calculateInterviewOverallScore(interview.questions);

    const rawReport = await generateReport({
      technology: interview.technology,
      experienceLevel: interview.experienceLevel,
      questions: interview.questions,
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
    await userStatsService.onInterviewCompleted(userId, overallScore);

    logger.info(`[interview.service] interview completed interviewId=${interviewId}`, {
      overallScore,
      reportScore: report.overallScore,
    });

    return report;
  } catch (error) {
    await repo.releaseReportGeneration(interviewId);
    throw error;
  }
};
