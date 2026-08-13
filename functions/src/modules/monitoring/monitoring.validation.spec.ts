import assert from "node:assert/strict";
import test from "node:test";
import { monitoringEventSchema, qualitySnapshotSchema, monitoringViolationSchema } from "./monitoring.validation";

test("accepts a valid periodic quality snapshot", () => {
  const result = qualitySnapshotSchema.safeParse({
    interviewId: "interview-1", camera: { available: true, resolution: "1280x720", fps: 30, qualityScore: 92 },
    network: { rtt: 48, jitter: 4, packetLoss: 0.2, bitrate: 1_500_000, connectionState: "connected", stabilityScore: 95 }, overallScore: 93,
  });
  assert.equal(result.success, true);
});

test("rejects invalid monitoring scores and event types", () => {
  assert.equal(qualitySnapshotSchema.safeParse({ interviewId: "interview-1", audio: { qualityScore: 101 } }).success, false);
  assert.equal(monitoringEventSchema.safeParse({ interviewId: "interview-1", type: "RAW_CAMERA_FRAME", severity: "info", state: "active" }).success, false);
});

test("requires a persisted duration for violations", () => {
  assert.equal(monitoringViolationSchema.safeParse({ interviewId: "interview-1", type: "FACE_MISSING", severity: "warning", durationSeconds: 0 }).success, false);
});
