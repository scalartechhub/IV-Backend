import "./load-env";
import { appConfig } from "./config/app.config";
import { bootstrapApplication, SecretValidationError } from "./bootstrap";
import { isStorageConfigured } from "./config/firebase";
import app from "./app";
import { logger } from "./shared/logger";
import * as teamsAlerter from "./shared/teams-alerter";
import { setupLiveInterviewWebSocket } from "./modules/live-interview/live-interview.ws";
import { setupV2LiveInterviewWebSocket } from "./modules/v2/live-interview-ws";
import { isCloudRuntime } from "./shared/runtime";

async function startServer() {
  try {
    await bootstrapApplication();
  } catch (error) {
    if (error instanceof SecretValidationError) {
      console.error(error.message);
      if (error.missingKeys.length > 0) {
        console.error(`Missing keys: ${error.missingKeys.join(", ")}`);
      }
    } else if (error instanceof Error) {
      console.error("Startup failed:", error.message);
    } else {
      console.error("Startup failed:", error);
    }
    process.exit(1);
  }

  const server = app.listen(appConfig.port, () => {
    logger.info(`Server running on port ${appConfig.port}`);
    logger.info(`Environment: ${appConfig.nodeEnv}`);
    if (!isStorageConfigured()) {
      logger.warn("FIREBASE_STORAGE_BUCKET not set — PDF files will be parsed but not stored");
    }
    setupLiveInterviewWebSocket(server);
    setupV2LiveInterviewWebSocket(server);
  });

  return server;
}

const serverPromise = startServer();


import { parseAiError } from "./middleware/error.middleware";

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  const parsed = parseAiError(err);
  const code = parsed?.statusCode || (err as any)?.status || (err as any)?.statusCode || 500;
  const cleanMsg = parsed?.cleanMessage || err.message;

  console.error(
    `\n[Unhandled Promise Rejection] ❌ HTTP ${code}\n` +
    `  Error: ${cleanMsg}\n` +
    (parsed?.howToFix ? `  HOW TO FIX: ${parsed.howToFix}\n` : "") +
    `  Stack: ${err.stack ?? "no stack"}\n`
  );

  void teamsAlerter.notify({
    context: "process.unhandledRejection",
    error: new Error(cleanMsg),
    extras: {
      "Status Code": String(code),
      "Function Type": "Express Server / Process",
      ...(parsed?.howToFix ? { "HOW TO FIX": parsed.howToFix } : {}),
    },
  });
});

process.on("uncaughtException", (error) => {
  const parsed = parseAiError(error);
  const code = parsed?.statusCode || (error as any)?.status || (error as any)?.statusCode || 500;
  const cleanMsg = parsed?.cleanMessage || error.message;

  console.error(
    `\n[Uncaught Exception] ❌ HTTP ${code}\n` +
    `  Error: ${cleanMsg}\n` +
    (parsed?.howToFix ? `  HOW TO FIX: ${parsed.howToFix}\n` : "") +
    `  Stack: ${error.stack ?? "no stack"}\n`
  );

  void teamsAlerter.notify({
    context: "process.uncaughtException",
    error: new Error(cleanMsg),
    extras: {
      "Status Code": String(code),
      "Function Type": "Express Server / Process",
      ...(parsed?.howToFix ? { "HOW TO FIX": parsed.howToFix } : {}),
    },
  });
});

const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received. Shutting down gracefully...`);
  try {
    const server = await serverPromise;
    server.close(() => {
      logger.info("Server closed successfully.");
      process.exit(0);
    });
  } catch {
    process.exit(1);
  }
};

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));


