import * as repo from "./interview.repository";
import { parseResume } from "../ai/resume-parser.service";
import { parseJD } from "../ai/jd-parser.service";
import { generateQuestions } from "../ai/question-generator.service";
import { evaluateAnswer } from "../ai/evaluation.service";
import { generateReport } from "../ai/report.service";
import { uploadFile } from "../storage/storage.service";
import { AppError } from "../../shared/utils";
import { logger } from "../../shared/logger";
import type {
  CreateInterviewInput,
  Interview,
  ListInterviewsQuery,
  PaginatedResult,
  Question,
  Report,
  SubmitAnswerInput,
  SubmitAnswerResult,
} from "./interview.types";
import { InterviewStatus } from "./interview.types";
import { calculateInterviewOverallPerformance } from "./interview.scoring";

export const createInterview = async (
  userId: string,
  input: CreateInterviewInput
): Promise<Interview> => {
  logger.info(`[interview.service] create interview userId=${userId}`, { role: input.role });
  return repo.createInterview(userId, input);
};

export const listInterviews = async (
  userId: string,
  query: ListInterviewsQuery
): Promise<PaginatedResult<Interview>> => {
  return repo.listInterviewsByUser(userId, query);
};

export const getInterview = async (userId: string, interviewId: string): Promise<Interview> => {
  return repo.requireOwnedInterview(interviewId, userId);
};

export const uploadResume = async (
  userId: string,
  interviewId: string,
  fileBuffer: Buffer
): Promise<Interview> => {
  const interview = await repo.requireOwnedInterview(interviewId, userId);

  logger.info(`[interview.service] uploading resume interviewId=${interviewId}`);

  await repo.updateInterview(interviewId, { status: InterviewStatus.PROCESSING });

  try {
    const resumeAnalysis = await parseResume(fileBuffer);

    let resumeURL: string | undefined;
    try {
      resumeURL = await uploadFile(interviewId, "resume", fileBuffer);
    } catch (storageError) {
      logger.warn(
        `[interview.service] resume storage upload failed interviewId=${interviewId}`,
        storageError
      );
    }

    const status = interview.jdAnalysis ? InterviewStatus.READY : InterviewStatus.DRAFT;

    return repo.updateInterview(interviewId, {
      ...(resumeURL && { resumeURL }),
      resumeAnalysis,
      status,
    });
  } catch (error) {
    await repo.updateInterview(interviewId, { status: InterviewStatus.FAILED });
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

  await repo.updateInterview(interviewId, { status: InterviewStatus.PROCESSING });

  try {
    const jdAnalysis = await parseJD(fileBuffer);

    let jdURL: string | undefined;
    try {
      jdURL = await uploadFile(interviewId, "jd", fileBuffer);
    } catch (storageError) {
      logger.warn(
        `[interview.service] JD storage upload failed interviewId=${interviewId}`,
        storageError
      );
    }

    const status = interview.resumeAnalysis ? InterviewStatus.READY : InterviewStatus.DRAFT;

    return repo.updateInterview(interviewId, {
      ...(jdURL && { jdURL }),
      jdAnalysis,
      status,
    });
  } catch (error) {
    await repo.updateInterview(interviewId, { status: InterviewStatus.FAILED });
    throw error;
  }
};

export const generateInterviewQuestions = async (
  userId: string,
  interviewId: string
): Promise<Question[]> => {
  const interview = await repo.requireOwnedInterview(interviewId, userId);

  if (!interview.resumeAnalysis) {
    throw new AppError(400, "Resume has not been uploaded and parsed yet.");
  }
  if (!interview.jdAnalysis) {
    throw new AppError(400, "Job description has not been uploaded and parsed yet.");
  }
  if (
    interview.status === InterviewStatus.IN_PROGRESS ||
    interview.status === InterviewStatus.COMPLETED
  ) {
    throw new AppError(400, "Cannot regenerate questions for an interview already in progress.");
  }

  logger.info(`[interview.service] generating questions interviewId=${interviewId}`);

  const rawQuestions = await generateQuestions({
    resumeAnalysis: interview.resumeAnalysis,
    jdAnalysis: interview.jdAnalysis,
    role: interview.role,
    experience: interview.experience,
  });

  const questions = await repo.saveQuestions(interviewId, userId, rawQuestions);

  await repo.updateInterview(interviewId, {
    totalQuestions: questions.length,
    status: InterviewStatus.READY,
  });

  logger.info(
    `[interview.service] ${questions.length} questions stored for interviewId=${interviewId}`
  );
  return questions;
};

export const getQuestions = async (
  userId: string,
  interviewId: string
): Promise<Question[]> => {
  await repo.requireOwnedInterview(interviewId, userId);
  return repo.getQuestionsByInterview(interviewId);
};

export const submitAnswer = async (
  userId: string,
  interviewId: string,
  input: SubmitAnswerInput
): Promise<SubmitAnswerResult> => {
  const interview = await repo.requireOwnedInterview(interviewId, userId);

  if (interview.status === InterviewStatus.COMPLETED) {
    throw new AppError(400, "This interview has already been completed.");
  }
  if (
    interview.status === InterviewStatus.DRAFT ||
    interview.status === InterviewStatus.FAILED
  ) {
    throw new AppError(400, "Interview is not ready for answering. Please generate questions first.");
  }

  const question = await repo.findQuestionById(input.questionId);
  if (!question) throw new AppError(404, "Question not found.");
  if (question.interviewId !== interviewId)
    throw new AppError(403, "Question does not belong to this interview.");

  logger.info(
    `[interview.service] submitting answer interviewId=${interviewId} questionId=${input.questionId}`
  );

  const isFirstAnswer = !(await repo.hasAnswerForQuestion(
    interviewId,
    input.questionId
  ));

  const answer = await repo.saveAnswer(interviewId, input.questionId, userId, input.answer);

  const rawEvaluation = await evaluateAnswer({
    question: question.question,
    answer: input.answer,
    role: interview.role,
    difficulty: question.difficulty,
    category: question.category,
  });

  const evaluation = await repo.saveEvaluation(
    interviewId,
    input.questionId,
    answer.id,
    userId,
    rawEvaluation
  );

  const [questions, evaluations] = await Promise.all([
    repo.getQuestionsByInterview(interviewId),
    repo.getEvaluationsByInterview(interviewId),
  ]);
  const overallPerformance = calculateInterviewOverallPerformance(
    questions,
    evaluations
  );

  await repo.updateInterview(interviewId, {
    ...(isFirstAnswer && {
      answeredQuestions: interview.answeredQuestions + 1,
    }),
    overallPerformance,
    status: InterviewStatus.IN_PROGRESS,
  });

  return { answer, evaluation };
};

export const finishInterview = async (
  userId: string,
  interviewId: string
): Promise<Report> => {
  const interview = await repo.requireOwnedInterview(interviewId, userId);

  if (interview.status === InterviewStatus.COMPLETED) {
    const existing = await repo.getReportByInterview(interviewId);
    if (existing) return existing;
  }

  if (
    interview.status === InterviewStatus.DRAFT ||
    interview.status === InterviewStatus.FAILED
  ) {
    throw new AppError(400, "Interview has no answers to generate a report from.");
  }

  logger.info(`[interview.service] finishing interview interviewId=${interviewId}`);

  const [questions, answers, evaluations] = await Promise.all([
    repo.getQuestionsByInterview(interviewId),
    repo.getAnswersByInterview(interviewId),
    repo.getEvaluationsByInterview(interviewId),
  ]);

  if (answers.length === 0) {
    throw new AppError(400, "No answers submitted yet. Answer at least one question before finishing.");
  }

  const overallPerformance = calculateInterviewOverallPerformance(
    questions,
    evaluations
  );

  const rawReport = await generateReport({
    role: interview.role,
    experience: interview.experience,
    questions,
    answers,
    evaluations,
  });

  const report = await repo.saveReport(interviewId, userId, rawReport);

  await repo.updateInterview(interviewId, {
    status: InterviewStatus.COMPLETED,
    overallPerformance,
  });

  logger.info(`[interview.service] interview completed interviewId=${interviewId}`, {
    overallPerformance,
    overallScore: report.overallScore,
  });

  return report;
};

export const getReport = async (userId: string, interviewId: string): Promise<Report> => {
  await repo.requireOwnedInterview(interviewId, userId);

  const report = await repo.getReportByInterview(interviewId);
  if (!report) {
    throw new AppError(404, "Report not found. Please finish the interview first.");
  }

  return report;
};
