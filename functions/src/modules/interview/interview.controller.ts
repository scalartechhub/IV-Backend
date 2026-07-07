import { Request, Response } from "express";
import * as interviewService from "./interview.service";
import * as authService from "../auth/auth.service";
import { sendSuccess, sendCreated } from "../../shared/responses";
import type { ListInterviewsQuery } from "./interview.validation";

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
  sendCreated(res, interview, "Interview created and questions generated successfully");
};

export const listInterviews = async (req: Request, res: Response): Promise<void> => {
  const { limit, startAfter } = req.query as unknown as ListInterviewsQuery;
  const result = await interviewService.listInterviews(req.user!.uid, { limit, startAfter });
  sendSuccess(res, result, "Interviews fetched successfully");
};

export const getInterview = async (req: Request, res: Response): Promise<void> => {
  const interview = await interviewService.getInterviewById(req.user!.uid, param(req, "id"));
  sendSuccess(res, interview, "Interview fetched successfully");
};

export const createInterviewWithDocuments = async (req: Request, res: Response): Promise<void> => {
  const interview = await interviewService.createInterviewWithDocuments(
    req.user!.uid,
    getUploadedDocumentBuffers(req)
  );
  sendCreated(res, interview, "Interview created with documents and questions generated successfully");
};

export const resumeAnalysis = async (req: Request, res: Response): Promise<void> => {
  const resumeAnalysisEntry = await authService.uploadResumeAnalysis(
    req.user!.uid,
    req.file!.buffer
  );
  sendSuccess(res, resumeAnalysisEntry, "Resume uploaded and analyzed successfully");
};

export const finishInterview = async (req: Request, res: Response): Promise<void> => {
  const result = await interviewService.finishInterview(req.user!.uid, param(req, "id"));
  sendSuccess(res, result, "Interview completed. Answers evaluated and report generated.");
};
