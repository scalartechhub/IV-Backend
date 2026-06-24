import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import apiRoutes from "./routes";
import { errorMiddleware, notFoundMiddleware } from "./middleware/error.middleware";
import { logger } from "./shared/logger";
import { RATE_LIMIT } from "./shared/constants";
import { appConfig } from "./config/app.config";

const parseCorsOrigin = (): cors.CorsOptions["origin"] => {
  const raw = appConfig.corsOrigin;
  if (!raw) {
    return appConfig.isProduction ? false : true;
  }
  if (raw === "*") {
    return appConfig.isProduction ? false : true;
  }
  return raw.split(",").map((origin) => origin.trim());
};

const app: Application = express();

app.use(helmet());
app.use(cors({ origin: parseCorsOrigin(), credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT.WINDOW_MS,
  max: RATE_LIMIT.MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later." },
});

const aiLimiter = rateLimit({
  windowMs: RATE_LIMIT.AI_WINDOW_MS,
  max: RATE_LIMIT.AI_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "AI rate limit exceeded. Please wait before making more AI-powered requests.",
  },
});

app.use("/api", globalLimiter);
app.use("/api/interviews/create-with-documents", aiLimiter);
app.use("/api/interviews/resume-analysis", aiLimiter);
app.use("/api/interviews/:id/generate-questions", aiLimiter);
app.use("/api/interviews/:id/answer", aiLimiter);
app.use("/api/interviews/:id/finish", aiLimiter);
app.use("/api/chat", aiLimiter);

app.use((req, _res, next) => {
  logger.info(`→ ${req.method} ${req.path}`);
  next();
});

app.use("/api", apiRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
