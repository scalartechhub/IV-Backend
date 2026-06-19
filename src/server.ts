import "dotenv/config";
import { appConfig } from "./config/app.config";
import { secretService, SecretValidationError } from "./config/secrets";
import { initializeFirebase, isStorageConfigured } from "./config/firebase";
import { initializeGemini } from "./config/gemini";
import app from "./app";
import { logger } from "./shared/logger";

try {
  secretService.initialize();
  initializeFirebase();
  initializeGemini();
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
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Promise Rejection:", reason);
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received. Shutting down gracefully...");
  server.close(() => process.exit(0));
});
