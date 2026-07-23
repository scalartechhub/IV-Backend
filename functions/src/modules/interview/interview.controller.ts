import { Request, Response } from "express";
import * as interviewService from "./interview.service";
import * as authService from "../auth/auth.service";
import * as resumePdfService from "./resume-pdf.service";
import { sendSuccess, sendCreated } from "../../shared/responses";
import type { ListInterviewsQuery, ResumePdfInput } from "./interview.validation";
import { getLiveWsPath, broadcastInterviewCompleted } from "../live-interview/live-interview.ws";

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
  sendCreated(res, interview, "Interview created and ready for live session");
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
  sendCreated(res, interview, "Interview created with documents and ready for live session");
};

export const resumeAnalysis = async (req: Request, res: Response): Promise<void> => {
  const analysis = await authService.uploadResumeAnalysis(
    req.user!.uid,
    req.file!.buffer,
    req.file!.originalname
  );
  sendSuccess(res, analysis, "Resume analyzed successfully");
};

export const resumePdf = async (req: Request, res: Response): Promise<void> => {
  const { html, fileName } = req.body as ResumePdfInput;
  const pdfBuffer = await resumePdfService.generateResumePdf(html);

  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${fileName}.pdf"`,
  });
  res.send(pdfBuffer);
};

export const finishInterview = async (req: Request, res: Response): Promise<void> => {
  const interviewId = param(req, "id");
  const result = await interviewService.finishInterview(req.user!.uid, interviewId);
  broadcastInterviewCompleted(interviewId);
  sendSuccess(res, result, "Interview completed. Answers evaluated and report generated.");
};

export const resumeInterview = async (req: Request, res: Response): Promise<void> => {
  const state = await interviewService.resumeInterview(req.user!.uid, param(req, "id"));
  sendSuccess(res, state, "Interview resume state fetched successfully");
};

const buildWsUrl = (req: Request, interviewId: string): string => {
  const forwardedProto = req.get("x-forwarded-proto");
  const protocol =
    forwardedProto === "https" || req.protocol === "https" ? "wss" : "ws";
  const host = req.get("host") ?? "localhost:5000";
  const authHeader = req.get("authorization") ?? "";
  const token =
    authHeader.startsWith("Bearer ") && authHeader.length > "Bearer ".length
      ? authHeader.slice("Bearer ".length).trim()
      : "";
  const query = new URLSearchParams({
    interviewId,
    ...(token ? { token } : {}),
  });
  return `${protocol}://${host}${getLiveWsPath()}?${query.toString()}`;
};

export const getLiveSession = async (req: Request, res: Response): Promise<void> => {
  const interview = await interviewService.prepareLiveSession(req.user!.uid, param(req, "id"));
  sendSuccess(res, {
    interviewId: interview.id,
    wsUrl: buildWsUrl(req, interview.id),
  });
};
