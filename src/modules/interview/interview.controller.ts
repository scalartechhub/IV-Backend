import { Request, Response } from "express";
import * as interviewService from "./interview.service";
import * as authService from "../auth/auth.service";
import { sendSuccess, sendCreated } from "../../shared/responses";

const param = (req: Request, key: string): string => String(req.params[key]);

const getUploadedDocumentBuffers = (
  req: Request
): { resumeBuffer?: Buffer; jdBuffer?: Buffer } => {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  return {
    resumeBuffer: files?.resume?.[0]?.buffer,
    jdBuffer: files?.jd?.[0]?.buffer,
  };
};

export const createInterview = async (req: Request, res: Response): Promise<void> => {
  const interview = await interviewService.createInterview(req.user!.uid, req.body);
  sendCreated(res, interview, "Interview created successfully");
};

export const createInterviewWithDocuments = async (req: Request, res: Response): Promise<void> => {
  const interview = await interviewService.createInterviewWithDocuments(
    req.user!.uid,
    getUploadedDocumentBuffers(req)
  );
  sendCreated(res, interview, "Interview created with documents successfully");
};

export const resumeAnalysis = async (req: Request, res: Response): Promise<void> => {
  const resumeAnalysisEntry = await authService.uploadResumeAnalysis(
    req.user!.uid,
    req.file!.buffer
  );
  sendSuccess(res, resumeAnalysisEntry, "Resume uploaded and analyzed successfully");
};

export const generateQuestions = async (req: Request, res: Response): Promise<void> => {
  const questions = await interviewService.generateInterviewQuestions(
    req.user!.uid,
    param(req, "id")
  );
  sendSuccess(res, { questions, total: questions.length }, "Questions generated successfully");
};

export const finishInterview = async (req: Request, res: Response): Promise<void> => {
  const result = await interviewService.finishInterview(req.user!.uid, param(req, "id"));
  sendSuccess(res, result, "Interview completed. Answers evaluated and report generated.");
};
