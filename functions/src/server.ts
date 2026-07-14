import "./load-env";
import { appConfig } from "./config/app.config";
import { bootstrapApplication, SecretValidationError } from "./bootstrap";
import { isStorageConfigured } from "./config/firebase";
import app from "./app";
import { logger } from "./shared/logger";
import { setupLiveInterviewWebSocket } from "./modules/live-interview/live-interview.ws";
import { isCloudRuntime } from "./shared/runtime";

try {
  bootstrapApplication();
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
  logger.info(`Chatbot API available at ${isCloudRuntime() ? "/chat-bot" : "/api/chat-bot"}`);
  if (!isStorageConfigured()) {
    logger.warn("FIREBASE_STORAGE_BUCKET not set — PDF files will be parsed but not stored");
  }
  if (!process.env.GROQ_API_KEY?.trim()) {
    logger.warn("GROQ_API_KEY is not set — chat endpoints will be unavailable");
  }
  if (!isCloudRuntime()) {
    setupLiveInterviewWebSocket(server);
  }
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Promise Rejection:", reason);
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received. Shutting down gracefully...");
  server.close(() => process.exit(0));
});
