import type { Application } from "express";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import app from "./app";
import { bootstrapApplication } from "./bootstrap";

// Callable functions (AllInterviewPro architecture)
export { startInterview } from "./callable/start-interview";
export { completeInterview } from "./callable/complete-interview";
export { submitCodingSolution } from "./callable/submit-coding-solution";
export { saveProfileSettings } from "./callable/save-profile-settings";
export { refreshCareerProgress } from "./callable/refresh-career-progress";

// Triggers
export { onInterviewComplete } from "./triggers/on-interview-complete";
export { onResumeUploaded } from "./triggers/on-resume-uploaded";
export { onAchievementCheck } from "./triggers/on-achievement-check";

// Scheduled
export { computeCareerProgress } from "./scheduled/compute-career-progress";
export { computeJobMatches } from "./scheduled/compute-job-matches";
export { resetWeeklyDeltas } from "./scheduled/reset-weekly-deltas";
export { archiveOldTranscripts } from "./scheduled/archive-old-transcripts";

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

let expressApp: Application | null = null;

async function getApp(): Promise<Application> {
  if (expressApp) return expressApp;

  await bootstrapApplication();
  expressApp = app;
  return expressApp;
}

export const api = onRequest(
  {
    memory: "1GiB",
    timeoutSeconds: 300,
    cors: false,
  },
  async (req, res) => {
    const initializedApp = await getApp();
    initializedApp(req, res);
  }
);


