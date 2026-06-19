import { Request, Response } from "express";
import * as interviewService from "./interview.service";
import { sendSuccess, sendCreated } from "../../shared/responses";
import type { ListInterviewsQuery } from "./interview.validation";

const param = (req: Request, key: string): string => String(req.params[key]);

export const createInterview = async (req: Request, res: Response): Promise<void> => {
  const interview = await interviewService.createInterview(req.user!.uid, req.body);
  sendCreated(res, interview, "Interview created successfully");
};

export const listInterviews = async (req: Request, res: Response): Promise<void> => {
  const result = await interviewService.listInterviews(
    req.user!.uid,
    req.query as unknown as ListInterviewsQuery
  );
  sendSuccess(res, result);
};

/** Single read — returns questions, answers, scores, feedback, and report when present. */
export const getInterview = async (req: Request, res: Response): Promise<void> => {
  const interview = await interviewService.getInterview(req.user!.uid, param(req, "id"));
  sendSuccess(res, interview);
};

export const uploadResume = async (req: Request, res: Response): Promise<void> => {
  const interview = await interviewService.uploadResume(
    req.user!.uid,
    param(req, "id"),
    req.file!.buffer
  );
  sendSuccess(res, interview, "Resume parsed successfully");
};

export const uploadJD = async (req: Request, res: Response): Promise<void> => {
  const interview = await interviewService.uploadJD(
    req.user!.uid,
    param(req, "id"),
    req.file!.buffer
  );
  sendSuccess(res, interview, "Job description parsed successfully");
};

export const generateQuestions = async (req: Request, res: Response): Promise<void> => {
  const questions = await interviewService.generateInterviewQuestions(
    req.user!.uid,
    param(req, "id")
  );
  sendSuccess(res, { questions, total: questions.length }, "Questions generated successfully");
};

export const getQuestions = async (req: Request, res: Response): Promise<void> => {
  const questions = await interviewService.getQuestions(req.user!.uid, param(req, "id"));
  sendSuccess(res, { questions, total: questions.length });
};

export const submitAnswers = async (req: Request, res: Response): Promise<void> => {
  const result = await interviewService.submitAnswers(
    req.user!.uid,
    param(req, "id"),
    req.body
  );
  sendSuccess(res, result, "Answers submitted and evaluated");
};

export const finishInterview = async (req: Request, res: Response): Promise<void> => {
  const report = await interviewService.finishInterview(req.user!.uid, param(req, "id"));
  sendSuccess(res, report, "Interview completed. Report generated successfully");
};

export const getReport = async (req: Request, res: Response): Promise<void> => {
  const report = await interviewService.getReport(req.user!.uid, param(req, "id"));
  sendSuccess(res, report);
};
