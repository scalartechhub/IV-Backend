import { AppError } from "../../shared/utils";
import { InterviewStatus } from "../interview/interview.types";
import * as interviewRepository from "../interview/interview.repository";
import * as repository from "./monitoring.repository";
import type { MonitoringEventInput, MonitoringViolationInput, QualitySnapshotInput } from "./monitoring.validation";
import type { MonitoringReport } from "./monitoring.types";

const requireActiveOwnedInterview = async (userId: string, interviewId: string) => {
  const interview = await interviewRepository.requireOwnedInterview(interviewId, userId);
  if (interview.status !== InterviewStatus.STARTED) {
    throw new AppError(409, "Start the interview monitoring session before submitting monitoring data.");
  }
  return interview;
};

export const start = async (userId: string, interviewId: string) => {
  await interviewRepository.requireOwnedInterview(interviewId, userId);
  const result = await interviewRepository.markInterviewStarted(interviewId);
  await repository.setSessionState(interviewId, "started");
  return { interviewId, started: result.created, status: result.interview.status };
};

export const end = async (userId: string, interviewId: string) => {
  await interviewRepository.requireOwnedInterview(interviewId, userId);
  await repository.setSessionState(interviewId, "ended");
  return { interviewId, ended: true };
};

export const recordEvent = async (userId: string, input: MonitoringEventInput) => {
  await requireActiveOwnedInterview(userId, input.interviewId);
  return repository.addEventIfStateChanged(input.interviewId, { type: input.type, severity: input.severity, state: input.state, metadata: input.metadata });
};

export const recordQualitySnapshot = async (userId: string, input: QualitySnapshotInput) => {
  await requireActiveOwnedInterview(userId, input.interviewId);
  try {
    return await repository.addQualitySnapshot(input.interviewId, { camera: input.camera, microphone: input.microphone, audio: input.audio, video: input.video, network: input.network, overallScore: input.overallScore });
  } catch (error) {
    if (error instanceof Error && error.message === "QUALITY_SNAPSHOT_TOO_FREQUENT") {
      throw new AppError(429, "Quality snapshots are limited to one every 5 seconds.");
    }
    throw error;
  }
};

export const recordViolation = async (userId: string, input: MonitoringViolationInput) => {
  await requireActiveOwnedInterview(userId, input.interviewId);
  return repository.addViolation(input.interviewId, { type: input.type, severity: input.severity, durationSeconds: input.durationSeconds, details: input.details, metadata: input.metadata });
};

export const getReport = async (userId: string, interviewId: string): Promise<MonitoringReport> => {
  await interviewRepository.requireOwnedInterview(interviewId, userId);
  const data = await repository.getMonitoringData(interviewId);
  const counts = (items: Array<{ type: string }>) => items.reduce<Record<string, number>>((result, item) => ({ ...result, [item.type]: (result[item.type] ?? 0) + 1 }), {});
  const scored = data.snapshots.filter((snapshot) => snapshot.overallScore !== undefined);
  return {
    interviewId, session: data.session, eventCounts: counts(data.events), violationCounts: counts(data.violations),
    totalEvents: data.events.length, totalViolations: data.violations.length,
    latestQualitySnapshot: data.snapshots[0],
    averageQualityScore: scored.length ? Math.round((scored.reduce((sum, snapshot) => sum + snapshot.overallScore!, 0) / scored.length) * 100) / 100 : undefined,
  };
};
