import "./load-env";
import type { Application } from "express";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import app from "./app";
import { bootstrapApplication } from "./bootstrap";

// ============================================================================
// ACTIVE TRIGGERS & SCHEDULED FUNCTIONS
// ============================================================================
export { onUserDeleted } from "./triggers/on-user-deleted";
export { checkExpiredSubscriptions } from "./scheduled/check-expired-subscriptions";
export { computeCareerProgress } from "./scheduled/compute-career-progress";
export { resetWeeklyDeltas } from "./scheduled/reset-weekly-deltas";

// ============================================================================
// DUMMY / UNUSED FUNCTIONS (COMMENTED OUT — NOT IN ACTIVE USE)
// All core application features are handled directly via the Express REST API (api).
// ============================================================================

// Callable functions (Unused / Dummy — not going to be used)
// export { startInterview } from "./callable/start-interview";
// export { completeInterview } from "./callable/complete-interview";
// export { submitCodingSolution } from "./callable/submit-coding-solution";
// export { saveProfileSettings } from "./callable/save-profile-settings";
// export { refreshCareerProgress } from "./callable/refresh-career-progress";

// Triggers (Unused / Dummy — not going to be used)
// export { onInterviewComplete } from "./triggers/on-interview-complete";
// export { onResumeUploaded } from "./triggers/on-resume-uploaded";
// export { onAchievementCheck } from "./triggers/on-achievement-check";

// Scheduled (Unused / Dummy — not going to be used)
// export { computeJobMatches } from "./scheduled/compute-job-matches";
// export { archiveOldTranscripts } from "./scheduled/archive-old-transcripts";

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


