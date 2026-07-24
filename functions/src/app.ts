import express, { Application, Request } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";

import apiRoutes from "./api/routes";
import { errorMiddleware, notFoundMiddleware } from "./middleware/error.middleware";
import { logger } from "./shared/logger";
import { RATE_LIMIT } from "./shared/constants";
import { appConfig } from "./config/app.config";
import { isCloudRuntime } from "./shared/runtime";

/** On Firebase Functions the function name is `api`, so routes mount at `/` not `/api`. */
const API_PREFIX = isCloudRuntime() ? "" : "/api";
const apiPath = (suffix: string): string => `${API_PREFIX}${suffix}`;

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
app.use(morgan("combined"));
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as Request).rawBody = buf;
    },
  })
);
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

const paymentLimiter = rateLimit({
  windowMs: RATE_LIMIT.WINDOW_MS,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many payment requests. Please try again later." },
});

app.use(apiPath("") || "/", globalLimiter);
app.use(apiPath("/interviews/create"), aiLimiter);
app.use(apiPath("/interviews/create-with-documents"), aiLimiter);
app.use(apiPath("/interviews/resume-analysis"), aiLimiter);
app.use(apiPath("/interviews/resume-pdf"), aiLimiter);
app.use(apiPath("/interviews/:id/finish"), aiLimiter);
app.use(apiPath("/v2/interviews/start"), aiLimiter);
app.use(apiPath("/v2/interviews/:id/complete"), aiLimiter);
app.use(apiPath("/v2/resumes/upload"), aiLimiter);
app.use(apiPath("/v2/resumes/analyze"), aiLimiter);
app.use(apiPath("/v2/roadmap/regenerate"), aiLimiter);
app.use(apiPath("/v2/coding/submit"), aiLimiter);
app.use(apiPath("/chat"), aiLimiter);
app.use(apiPath("/chat-bot"), aiLimiter);
app.use(apiPath("/ats/analyze"), aiLimiter);
app.use(apiPath("/payment/create-order"), paymentLimiter);
app.use(apiPath("/payment/verify"), paymentLimiter);

app.use((req, _res, next) => {
  logger.info(`→ ${req.method} ${req.path}`);
  next();
});

app.use(apiPath("") || "/", apiRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
