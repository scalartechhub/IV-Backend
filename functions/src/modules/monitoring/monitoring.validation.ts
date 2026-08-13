import { z } from "zod";
import { MONITORING_EVENT_TYPES, MONITORING_SEVERITIES } from "./monitoring.types";

const score = z.number().finite().min(0).max(100);
const metric = z.object({
  available: z.boolean().optional(), resolution: z.string().max(40).optional(), fps: z.number().finite().min(0).max(240).optional(),
  qualityScore: score.optional(), inputLevel: z.number().finite().min(0).max(100).optional(), voiceDetected: z.boolean().optional(),
  noiseLevel: z.number().finite().min(0).max(100).optional(), clipping: z.boolean().optional(), clarity: score.optional(), noise: score.optional(), voiceActivity: score.optional(),
  droppedFrames: z.number().int().min(0).max(1_000_000).optional(), latency: z.number().finite().min(0).max(120_000).optional(), rtt: z.number().finite().min(0).max(120_000).optional(),
  jitter: z.number().finite().min(0).max(120_000).optional(), packetLoss: z.number().finite().min(0).max(100).optional(), bitrate: z.number().finite().min(0).max(1_000_000_000).optional(),
  connectionState: z.enum(["new", "connecting", "connected", "disconnected", "failed", "closed"]).optional(), stabilityScore: score.optional(),
}).strict();

const metadata = z.record(z.string().min(1).max(100), z.unknown()).optional();
const interviewId = z.string().min(1).max(200);

export const startInterviewMonitoringSchema = z.object({ interviewId });
export const endInterviewMonitoringSchema = z.object({ interviewId });
export const qualitySnapshotSchema = z.object({
  interviewId, camera: metric.optional(), microphone: metric.optional(), audio: metric.optional(), video: metric.optional(), network: metric.optional(), overallScore: score.optional(),
}).refine((value) => Boolean(value.camera || value.microphone || value.audio || value.video || value.network || value.overallScore !== undefined), { message: "At least one quality metric is required" });
export const monitoringEventSchema = z.object({
  interviewId, type: z.enum(MONITORING_EVENT_TYPES), severity: z.enum(MONITORING_SEVERITIES), state: z.enum(["active", "resolved"]), metadata,
});
export const monitoringViolationSchema = z.object({
  interviewId, type: z.enum(MONITORING_EVENT_TYPES), severity: z.enum(["warning", "critical"]), durationSeconds: z.number().finite().min(1).max(86_400), details: z.string().trim().min(1).max(1_000).optional(), metadata,
});
export const monitoringInterviewParamSchema = z.object({ interviewId });

export type StartMonitoringInput = z.infer<typeof startInterviewMonitoringSchema>;
export type QualitySnapshotInput = z.infer<typeof qualitySnapshotSchema>;
export type MonitoringEventInput = z.infer<typeof monitoringEventSchema>;
export type MonitoringViolationInput = z.infer<typeof monitoringViolationSchema>;
