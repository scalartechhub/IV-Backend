import * as repo from "./interview.repository";
import { parseResume } from "../ai/resume-parser.service";
import { parseJD } from "../ai/jd-parser.service";
import { generateQuestions } from "../ai/question-generator.service";
import { evaluateAnswersBatch } from "../ai/evaluation.service";
import { generateReport } from "../ai/report.service";
import { uploadFile } from "../storage/storage.service";
import { getUserProfile } from "../auth/auth.repository";
import { AppError } from "../../shared/utils";
import { logger } from "../../shared/logger";
import type {
  CreateInterviewInput,
  Interview,
  ListInterviewsQuery,
  PaginatedResult,
  Question,
  Report,
  SubmitAnswersInput,
  SubmitAnswersResult,
  Answer,
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

  if (
    interview.status === InterviewStatus.IN_PROGRESS ||
    interview.status === InterviewStatus.COMPLETED
  ) {
    throw new AppError(400, "Cannot regenerate questions for an interview already in progress.");
  }

  const userProfile = await getUserProfile(userId);

  logger.info(`[interview.service] generating questions interviewId=${interviewId}`, {
    hasResume: Boolean(interview.resumeAnalysis),
    hasJD: Boolean(interview.jdAnalysis),
  });

  const rawQuestions = await generateQuestions({
    resumeAnalysis: interview.resumeAnalysis,
    jdAnalysis: interview.jdAnalysis,
    userProfile,
    role: interview.role,
    experience: interview.experience,
    interviewType: interview.type,
  });

  await repo.deleteQuestionsByInterview(interviewId);

  const questions = await repo.saveQuestions(interviewId, userId, rawQuestions);

  await repo.updateInterview(interviewId, {
    totalQuestions: questions.length,
    answeredQuestions: 0,
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

export const submitAnswers = async (
  userId: string,
  interviewId: string,
  input: SubmitAnswersInput
): Promise<SubmitAnswersResult> => {
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

  const questions = await repo.getQuestionsByInterview(interviewId);
  if (questions.length === 0) {
    throw new AppError(400, "No questions found. Please generate questions first.");
  }

  const questionById = new Map(questions.map((q) => [q.id, q]));

  for (const item of input.answers) {
    const question = questionById.get(item.questionId);
    if (!question) {
      throw new AppError(404, `Question not found: ${item.questionId}`);
    }
  }

  logger.info(
    `[interview.service] submitting ${input.answers.length} answers interviewId=${interviewId}`
  );

  const savedAnswers: { questionId: string; answer: Answer }[] = [];

  for (const item of input.answers) {
    const answer = await repo.saveAnswer(
      interviewId,
      item.questionId,
      userId,
      item.answer
    );
    savedAnswers.push({ questionId: item.questionId, answer });
  }

  const batchItems = input.answers.map((item) => {
    const question = questionById.get(item.questionId)!;
    return {
      questionId: item.questionId,
      question: question.question,
      answer: item.answer,
      difficulty: question.difficulty,
      category: question.category,
    };
  });

  const evaluationsByQuestionId = await evaluateAnswersBatch({
    role: interview.role,
    items: batchItems,
  });

  const results: SubmitAnswersResult["results"] = [];

  for (const { questionId, answer } of savedAnswers) {
    const rawEvaluation = evaluationsByQuestionId.get(questionId);
    if (!rawEvaluation) {
      throw new AppError(500, `Missing evaluation for question ${questionId}`);
    }

    const evaluation = await repo.saveEvaluation(
      interviewId,
      questionId,
      answer.id,
      userId,
      rawEvaluation
    );

    results.push({ answer, evaluation });
  }

  const [evaluations, allAnswers] = await Promise.all([
    repo.getEvaluationsByInterview(interviewId),
    repo.getAnswersByInterview(interviewId),
  ]);

  const overallPerformance = calculateInterviewOverallPerformance(
    questions,
    evaluations
  );
  const answeredQuestions = new Set(allAnswers.map((a) => a.questionId)).size;

  await repo.updateInterview(interviewId, {
    answeredQuestions,
    overallPerformance,
    status: InterviewStatus.IN_PROGRESS,
  });

  return { results, overallPerformance, answeredQuestions };
};

export const finishInterview = async (
  userId: string,
  interviewId: string
): Promise<Report> => {
  const interview = await repo.requireOwnedInterview(interviewId, userId);

  if (
    interview.status === InterviewStatus.DRAFT ||
    interview.status === InterviewStatus.FAILED
  ) {
    throw new AppError(400, "Interview has no answers to generate a report from.");
  }

  const claim = await repo.claimReportGeneration(interviewId, userId);
  if (claim !== "proceed") {
    return claim;
  }

  logger.info(`[interview.service] finishing interview interviewId=${interviewId}`);

  try {
    const [questions, answers, evaluations] = await Promise.all([
      repo.getQuestionsByInterview(interviewId),
      repo.getAnswersByInterview(interviewId),
      repo.getEvaluationsByInterview(interviewId),
    ]);

    if (answers.length === 0) {
      throw new AppError(
        400,
        "No answers submitted yet. Answer at least one question before finishing."
      );
    }

    const overallPerformance = calculateInterviewOverallPerformance(questions, evaluations);

    const rawReport = await generateReport({
      role: interview.role,
      experience: interview.experience,
      questions,
      answers,
      evaluations,
    });

    const report = await repo.completeReport(
      interviewId,
      userId,
      rawReport,
      overallPerformance
    );

    logger.info(`[interview.service] interview completed interviewId=${interviewId}`, {
      overallPerformance,
      overallScore: report.overallScore,
    });

    return report;
  } catch (error) {
    await repo.releaseReportGeneration(interviewId);
    throw error;
  }
};

export const getReport = async (userId: string, interviewId: string): Promise<Report> => {
  await repo.requireOwnedInterview(interviewId, userId);

  const report = await repo.getReportByInterview(interviewId);
  if (!report) {
    throw new AppError(404, "Report not found. Please finish the interview first.");
  }

  return report;
};
