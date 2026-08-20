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
  const raw = appConfig.corsOrigin || process.env.CORS_ORIGIN;
  const configured = raw
    ? raw.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [];

  const defaultAllowed = [
    "https://app.interviewup.ai",
    "https://www.app.interviewup.ai",
    "https://interview-prod-dd24f.web.app",
    "https://interview-prod-dd24f.firebaseapp.com",
    "http://localhost:4200",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:4200",
  ];

  const allowedSet = new Set([...configured, ...defaultAllowed]);

  return (origin, callback) => {
    // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
    if (!origin) {
      return callback(null, true);
    }
    if (allowedSet.has(origin)) {
      return callback(null, true);
    }
    // Allow any localhost / 127.0.0.1 port for local development
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    // Allow subdomains of interviewup.ai, web.app, firebaseapp.com
    if (/\.interviewup\.ai$/.test(origin) || /\.web\.app$/.test(origin) || /\.firebaseapp\.com$/.test(origin)) {
      return callback(null, true);
    }

    logger.warn(`[CORS] Blocked request from unauthorized origin: ${origin}`);
    callback(null, false);
  };
};

const app: Application = express();

// Trust Render / Cloudflare reverse proxy headers so rate limiting targets individual client IPs rather than Render's load balancer IP
app.set("trust proxy", 1);

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
  max: appConfig.isDevelopment ? 2000 : RATE_LIMIT.MAX_REQUESTS,
  // Quality snapshots are intentionally periodic (every 5–10 seconds) and have
  // their own tighter per-minute limiter in the monitoring router.
  skip: (req) => req.path.includes("/interview/monitoring/quality"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later." },
});

const aiLimiter = rateLimit({
  windowMs: RATE_LIMIT.AI_WINDOW_MS,
  max: appConfig.isDevelopment ? 200 : RATE_LIMIT.AI_MAX_REQUESTS,
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
app.use(apiPath("/v2/resumes/analyze"), aiLimiter);
app.use(apiPath("/v2/onboarding/analyze-from-answers"), aiLimiter);
app.use(apiPath("/v2/roadmap/regenerate"), aiLimiter);
app.use(apiPath("/v2/coding/run"), aiLimiter);
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
