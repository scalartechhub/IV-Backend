import { Request, Response } from "express";
import * as interviewService from "./interview.service";
import { sendSuccess, sendCreated, sendError } from "../../shared/responses";
import { logger } from "../../shared/logger";
import { AppError } from "../../shared/utils";
import { listInterviewsQuerySchema } from "./interview.validation";
import type { InterviewStatus } from "./interview.types";

const handleError = (res: Response, error: unknown, context: string): void => {
  logger.error(`[${context}]`, error);
  if (error instanceof AppError) {
    sendError(res, error.message, error.statusCode, error.details);
  } else {
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    sendError(res, message, 500);
  }
};

const param = (req: Request, key: string): string => String(req.params[key]);

export const createInterview = async (req: Request, res: Response): Promise<void> => {
  try {
    const interview = await interviewService.createInterview(req.user!.uid, req.body);
    sendCreated(res, interview, "Interview created successfully");
  } catch (error) {
    handleError(res, error, "createInterview");
  }
};

export const listInterviews = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = listInterviewsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(res, "Invalid query parameters", 400, parsed.error.flatten().fieldErrors);
      return;
    }

    const result = await interviewService.listInterviews(req.user!.uid, {
      page: parsed.data.page,
      limit: parsed.data.limit,
      status: parsed.data.status as InterviewStatus | undefined,
    });

    sendSuccess(res, result);
  } catch (error) {
    handleError(res, error, "listInterviews");
  }
};

export const getInterview = async (req: Request, res: Response): Promise<void> => {
  try {
    const interview = await interviewService.getInterview(req.user!.uid, param(req, "id"));
    sendSuccess(res, interview);
  } catch (error) {
    handleError(res, error, "getInterview");
  }
};

export const uploadResume = async (req: Request, res: Response): Promise<void> => {
  try {
    const interview = await interviewService.uploadResume(
      req.user!.uid,
      param(req, "id"),
      req.file!.buffer
    );

    sendSuccess(res, interview, "Resume parsed successfully");
  } catch (error) {
    handleError(res, error, "uploadResume");
  }
};

export const uploadJD = async (req: Request, res: Response): Promise<void> => {
  try {
    const interview = await interviewService.uploadJD(
      req.user!.uid,
      param(req, "id"),
      req.file!.buffer
    );

    sendSuccess(res, interview, "Job description parsed successfully");
  } catch (error) {
    handleError(res, error, "uploadJD");
  }
};

export const generateQuestions = async (req: Request, res: Response): Promise<void> => {
  try {
    const questions = await interviewService.generateInterviewQuestions(
      req.user!.uid,
      param(req, "id")
    );
    sendSuccess(res, { questions, total: questions.length }, "Questions generated successfully");
  } catch (error) {
    handleError(res, error, "generateQuestions");
  }
};

export const getQuestions = async (req: Request, res: Response): Promise<void> => {
  try {
    const questions = await interviewService.getQuestions(req.user!.uid, param(req, "id"));
    sendSuccess(res, { questions, total: questions.length });
  } catch (error) {
    handleError(res, error, "getQuestions");
  }
};

export const submitAnswer = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await interviewService.submitAnswer(
      req.user!.uid,
      param(req, "id"),
      req.body
    );
    sendSuccess(res, result, "Answer submitted and evaluated");
  } catch (error) {
    handleError(res, error, "submitAnswer");
  }
};

export const finishInterview = async (req: Request, res: Response): Promise<void> => {
  try {
    const report = await interviewService.finishInterview(req.user!.uid, param(req, "id"));
    sendSuccess(res, report, "Interview completed. Report generated successfully");
  } catch (error) {
    handleError(res, error, "finishInterview");
  }
};

export const getReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const report = await interviewService.getReport(req.user!.uid, param(req, "id"));
    sendSuccess(res, report);
  } catch (error) {
    handleError(res, error, "getReport");
  }
};
