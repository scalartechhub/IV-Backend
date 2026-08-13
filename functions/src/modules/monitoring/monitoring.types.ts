import type { Timestamp } from "firebase-admin/firestore";

export const MONITORING_EVENT_TYPES = [
  "FACE_MISSING", "MULTIPLE_FACES", "LOOKING_AWAY", "HEAD_MOVEMENT", "FACE_TOO_CLOSE", "FACE_TOO_FAR",
  "CAMERA_DISCONNECTED", "MICROPHONE_DISCONNECTED", "MICROPHONE_LOW", "MICROPHONE_SILENT", "HIGH_BACKGROUND_NOISE", "VIDEO_QUALITY_LOW", "AUDIO_QUALITY_LOW",
  "NETWORK_UNSTABLE", "HIGH_LATENCY", "HIGH_PACKET_LOSS", "HIGH_JITTER", "CONNECTION_LOST",
] as const;
export type MonitoringEventType = (typeof MONITORING_EVENT_TYPES)[number];

export const MONITORING_SEVERITIES = ["info", "warning", "critical"] as const;
export type MonitoringSeverity = (typeof MONITORING_SEVERITIES)[number];
export type MonitoringState = "active" | "resolved";

export interface MonitoringEvent {
  id: string; type: MonitoringEventType; severity: MonitoringSeverity; state: MonitoringState;
  metadata?: Record<string, unknown>; occurredAt: Timestamp; createdAt: Timestamp;
}

export interface MonitoringViolation {
  id: string; type: MonitoringEventType; severity: Exclude<MonitoringSeverity, "info">;
  durationSeconds: number; details?: string; metadata?: Record<string, unknown>;
  occurredAt: Timestamp; createdAt: Timestamp;
}

export interface MonitoringQualitySnapshot {
  id: string; camera?: Record<string, unknown>; microphone?: Record<string, unknown>;
  audio?: Record<string, unknown>; video?: Record<string, unknown>; network?: Record<string, unknown>;
  overallScore?: number; capturedAt: Timestamp; createdAt: Timestamp;
}

export interface MonitoringReport {
  interviewId: string; session: Record<string, unknown> | undefined;
  eventCounts: Record<string, number>; violationCounts: Record<string, number>;
  totalEvents: number; totalViolations: number; latestQualitySnapshot?: MonitoringQualitySnapshot;
  averageQualityScore?: number;
}
