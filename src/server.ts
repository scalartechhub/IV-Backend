import "dotenv/config";
import "./config/env";
import app from "./app";
import { logger } from "./shared/logger";
import { isStorageConfigured } from "./config/firebase";

const PORT = process.env.PORT ?? 5000;

const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV ?? "development"}`);
  if (!isStorageConfigured()) {
    logger.warn("FIREBASE_STORAGE_BUCKET not set — PDF files will be parsed but not stored");
  }
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Promise Rejection:", reason);
  server.close(() => process.exit(1));
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received. Shutting down gracefully...");
  server.close(() => process.exit(0));
});
