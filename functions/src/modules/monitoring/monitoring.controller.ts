import type { Request, Response } from "express";
import { sendCreated, sendSuccess } from "../../shared/responses";
import * as service from "./monitoring.service";
import type { MonitoringEventInput, MonitoringViolationInput, QualitySnapshotInput, StartMonitoringInput } from "./monitoring.validation";

const id = (req: Request) => String(req.params.interviewId);
export const start = async (req: Request, res: Response) => sendCreated(res, await service.start(req.user!.uid, (req.body as StartMonitoringInput).interviewId), "Interview monitoring started");
export const end = async (req: Request, res: Response) => sendSuccess(res, await service.end(req.user!.uid, (req.body as StartMonitoringInput).interviewId), "Interview monitoring ended");
export const quality = async (req: Request, res: Response) => sendCreated(res, await service.recordQualitySnapshot(req.user!.uid, req.body as QualitySnapshotInput), "Quality snapshot recorded");
export const event = async (req: Request, res: Response) => { const result = await service.recordEvent(req.user!.uid, req.body as MonitoringEventInput); sendSuccess(res, result, result.created ? "Monitoring event recorded" : "Monitoring state unchanged; event not recorded"); };
export const violation = async (req: Request, res: Response) => sendCreated(res, await service.recordViolation(req.user!.uid, req.body as MonitoringViolationInput), "Monitoring violation recorded");
export const report = async (req: Request, res: Response) => sendSuccess(res, await service.getReport(req.user!.uid, id(req)), "Monitoring report fetched");
