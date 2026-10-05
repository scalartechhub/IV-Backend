import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { appConfig } from "../config/app.config";
import { AppError } from "../shared/utils";
import { logger } from "../shared/logger";
import * as teamsAlerter from "../shared/teams-alerter";
import {
  formatMulterError,
  type ApiFieldError,
} from "../shared/errors";

interface ErrorResponseBody {
  success: false;
  statusCode: number;
  message: string;
  error?: string;
  errors?: ApiFieldError[];
  howToFix?: string;
}

export interface ResolvedErrorInfo {
  statusCode: number;
  category: string;
  cleanMessage: string;
  rawMessage: string;
  howToFix?: string;
  errors?: ApiFieldError[];
}

/**
 * Truncate helper for logs and alert payloads
 */
const truncate = (text: string, maxLen: number): string => {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
};

/**
 * Parses any raw error (AI error, API error, JSON error, DB error, Auth error)
 * into a standardized structured format with exact HTTP status code and actionable resolution.
 */
export const parseAiError = (error: unknown): { statusCode: number; cleanMessage: string; howToFix?: string } | null => {
  const errObj = error instanceof Error ? error : null;
  const rawMessage = errObj?.message ?? (typeof error === "string" ? error : JSON.stringify(error) || "");

  // 1. Google GenAI / external AI API embedded JSON error (e.g. ApiError: {"error":{"code":402,"message":"..."}})
  if (
    rawMessage.includes('{"error":') ||
    (errObj && (errObj.name === "ApiError" || errObj.name === "APIError"))
  ) {
    const jsonStart = rawMessage.indexOf('{"error":');
    if (jsonStart !== -1) {
      try {
        let depth = 0;
        let inString = false;
        let escapeNext = false;
        let jsonEnd = -1;

        for (let i = jsonStart; i < rawMessage.length; i++) {
          const char = rawMessage[i];
          if (escapeNext) { escapeNext = false; continue; }
          if (char === "\\") { escapeNext = true; continue; }
          if (char === '"') { inString = !inString; continue; }
          if (!inString) {
            if (char === "{") depth++;
            else if (char === "}") {
              depth--;
              if (depth === 0) { jsonEnd = i + 1; break; }
            }
          }
        }

        const jsonStr = jsonEnd !== -1 ? rawMessage.slice(jsonStart, jsonEnd) : rawMessage.slice(jsonStart);
        const parsed = JSON.parse(jsonStr);
        if (parsed?.error) {
          const code = Number(parsed.error.code) || Number((error as any)?.status) || 500;
          const msg = parsed.error.message || rawMessage;
          const lowerMsg = msg.toLowerCase();
          const isCreditsDepleted = code === 402 || lowerMsg.includes("credit") || lowerMsg.includes("prepayment");
          const isQuota = code === 429 || msg.includes("RESOURCE_EXHAUSTED") || lowerMsg.includes("quota");
          const isNotFound = code === 404 || msg.includes("NOT_FOUND") || lowerMsg.includes("no longer available") || lowerMsg.includes("is not found");

          if (isCreditsDepleted) {
            return {
              statusCode: 402,
              cleanMessage: `Gemini AI Error (402): Prepayment credits are depleted (${msg})`,
              howToFix: "Your Google AI Studio prepayment credits are depleted. Please top up credits or manage billing at https://ai.studio/projects.",
            };
          }

          if (isQuota) {
            return {
              statusCode: 429,
              cleanMessage: `Gemini AI Error (429): Rate limit or quota exceeded (${msg})`,
              howToFix: "Slow down request frequency or check quota limits in Google AI Studio.",
            };
          }

          if (isNotFound) {
            return {
              statusCode: 404,
              cleanMessage: `Gemini AI Error (404): ${msg}`,
              howToFix: "The AI model is retired or not found. Update to an active model in Firestore config/genai (e.g. gemini-3.6-flash, gemini-3.8-flash, or gemini-3.5-flash-lite).",
            };
          }

          return {
            statusCode: code >= 400 && code < 600 ? code : 502,
            cleanMessage: `Gemini AI Error (${code}): ${msg}`,
            howToFix: "Check your Google AI Studio configuration and API key in Firestore collection \"config\", document \"genai\".",
          };
        }
      } catch {
        // ignore parse failure, proceed to string heuristics
      }
    }
  }

  // 2. Direct status on error object (e.g. ApiError.status)
  const directStatus = Number((error as any)?.status || (error as any)?.statusCode);
  if (directStatus && directStatus >= 400 && directStatus < 600) {
    const lower = rawMessage.toLowerCase();
    if (directStatus === 402 || lower.includes("credit") || lower.includes("prepayment")) {
      return {
        statusCode: 402,
        cleanMessage: `Gemini AI Error (402): Prepayment credits are depleted (${rawMessage})`,
        howToFix: "Top up prepayment credits or manage project billing in Google AI Studio at https://ai.studio/projects.",
      };
    }
    if (directStatus === 404 || lower.includes("not found") || lower.includes("no longer available")) {
      return {
        statusCode: 404,
        cleanMessage: `Gemini AI Error (404): ${rawMessage}`,
        howToFix: "The AI model is retired or not found. Update to an active model in Firestore config/genai.",
      };
    }
    if (directStatus === 429 || lower.includes("quota") || lower.includes("resource_exhausted")) {
      return {
        statusCode: 429,
        cleanMessage: `Gemini AI Error (429): ${rawMessage}`,
        howToFix: "Rate limit or quota exceeded in Google AI Studio.",
      };
    }
  }

  // 3. Plain text prepayment credits depletion
  if (rawMessage.toLowerCase().includes("prepayment credits") || rawMessage.toLowerCase().includes("credits are depleted")) {
    return {
      statusCode: 402,
      cleanMessage: `Gemini AI Error (402): ${rawMessage}`,
      howToFix: "Top up prepayment credits or manage project billing in Google AI Studio at https://ai.studio/projects.",
    };
  }

  // 4. Plain text model retirement (404)
  if (
    rawMessage.toLowerCase().includes("is no longer available") ||
    rawMessage.includes("NOT_FOUND") ||
    rawMessage.includes("models/gemini")
  ) {
    if (rawMessage.toLowerCase().includes("no longer available") || rawMessage.includes("404")) {
      return {
        statusCode: 404,
        cleanMessage: `Gemini AI Error (404): ${rawMessage}`,
        howToFix: "The AI model is retired or not found. Update to an active model in Firestore config/genai (e.g. gemini-3.6-flash, gemini-3.8-flash, or gemini-3.5-flash-lite).",
      };
    }
  }

  // 5. Authentication issues
  if (
    rawMessage.includes('"UNAUTHENTICATED"') ||
    rawMessage.includes("ACCESS_TOKEN_TYPE_UNSUPPORTED") ||
    rawMessage.includes("invalid authentication credentials") ||
    rawMessage.includes("API_KEY_INVALID")
  ) {
    return {
      statusCode: 401,
      cleanMessage: "Gemini API authentication failed: The API key in Firestore (config/genai) or environment variables is invalid, unauthorized, or expired.",
      howToFix: "Set a valid Google AI Studio Key (starting with AIzaSy...) at https://aistudio.google.com/app/apikey and update Firestore config/genai.",
    };
  }

  return null;
};

/**
 * Resolves any thrown error into a full ResolvedErrorInfo descriptor.
 */
export const resolveErrorInfo = (error: unknown, req?: Request): ResolvedErrorInfo => {
  const errObj = error instanceof Error ? error : null;
  const rawMessage = errObj?.message ?? (typeof error === "string" ? error : String(error));

  // 1. AppError
  if (error instanceof AppError) {
    let category = "Server Error";
    let howToFix: string | undefined;

    switch (error.statusCode) {
      case 400:
        category = "Validation / Bad Request";
        howToFix = "Check request parameters and body schema.";
        break;
      case 401:
        category = "Auth / Unauthorized";
        howToFix = 'Make sure you are sending a valid Firebase ID token in "Authorization: Bearer <token>".';
        break;
      case 402:
        category = "Payment / Quota Depleted";
        howToFix = "Check Gemini API prepayment credits in Google AI Studio at https://ai.studio/projects or Razorpay subscription.";
        break;
      case 403:
        category = "Auth / Forbidden";
        howToFix = "The user does not have permission for this resource. Check user subscription tier.";
        break;
      case 404:
        category = "Resource Not Found";
        howToFix = "Check that the requested document or endpoint ID exists.";
        break;
      case 409:
        category = "Conflict";
        howToFix = "The resource is currently in a conflicting state. Try again or check prerequisites.";
        break;
      case 429:
        category = "Rate Limit Exceeded";
        howToFix = "Slow down request rate or check rate limits.";
        break;
      case 502:
        category = "AI / Gateway Error";
        howToFix = "AI service returned an unreadable response. Retry request or check Gemini API status.";
        break;
      case 503:
        category = "Service Unavailable";
        howToFix = "Service temporarily overloaded or database index is building.";
        break;
    }

    return {
      statusCode: error.statusCode,
      category,
      cleanMessage: error.message,
      rawMessage,
      howToFix,
      errors: error.errors,
    };
  }

  // 2. AI API Error (Google GenAI, Groq, etc.)
  const aiParsed = parseAiError(error);
  if (aiParsed) {
    let category = "AI Service";
    if (aiParsed.statusCode === 402) category = "Payment / AI Credits Depleted";
    else if (aiParsed.statusCode === 404) category = "AI Service / Model Retired";
    else if (aiParsed.statusCode === 429) category = "AI Service / Quota Exceeded";
    else if (aiParsed.statusCode === 401) category = "AI Service / Authentication";

    return {
      statusCode: aiParsed.statusCode,
      category,
      cleanMessage: aiParsed.cleanMessage,
      rawMessage,
      howToFix: aiParsed.howToFix,
    };
  }

  // 3. Multer File Upload Errors
  if (error instanceof multer.MulterError) {
    const isInterviewDocs = req?.path.includes("create-with-documents");
    const fieldHint = isInterviewDocs
      ? 'Unexpected file field. Use form-data keys "resume" and/or "jd" (type: File).'
      : 'Unexpected file field. Use form-data key "file" (type: File).';

    return {
      statusCode: 400,
      category: "Upload / Validation",
      cleanMessage: formatMulterError(error, fieldHint),
      rawMessage,
      howToFix: `Check uploaded file size and form-data field names (${fieldHint}).`,
    };
  }

  if (rawMessage === "Unexpected field") {
    const isInterviewDocs = req?.path.includes("create-with-documents");
    const hint = isInterviewDocs
      ? 'Unexpected file field. Use form-data keys "resume" and/or "jd" (type: File).'
      : 'Unexpected file field. Use form-data key "file" (type: File).';
    return {
      statusCode: 400,
      category: "Upload / Validation",
      cleanMessage: hint,
      rawMessage,
      howToFix: hint,
    };
  }

  if (rawMessage.toLowerCase().includes("only pdf")) {
    return {
      statusCode: 400,
      category: "Upload / Validation",
      cleanMessage: "Only PDF files are allowed. Please upload a .pdf file.",
      rawMessage,
      howToFix: "Convert the document to PDF format before uploading.",
    };
  }

  // 4. JSON Syntax Error
  if (error instanceof SyntaxError && "body" in (error as any)) {
    return {
      statusCode: 400,
      category: "Request Body / JSON Syntax",
      cleanMessage: "Invalid JSON in request body. Please check the request format and try again.",
      rawMessage,
      howToFix: "Validate JSON body formatting using a tool like https://jsonlint.com.",
    };
  }

  // 5. Firestore Index Missing
  if (rawMessage.includes("FAILED_PRECONDITION") && rawMessage.includes("index")) {
    return {
      statusCode: 503,
      category: "Database / Firestore Index Missing",
      cleanMessage: "A database index is still being built or is missing. Please try again shortly.",
      rawMessage,
      howToFix: "Open Firebase Console → Firestore → Indexes and build the composite index indicated in logs.",
    };
  }

  // 6. Direct status or statusCode on arbitrary Error objects
  const rawStatus = Number((error as any)?.status || (error as any)?.statusCode);
  if (rawStatus && rawStatus >= 400 && rawStatus < 600) {
    return {
      statusCode: rawStatus,
      category: rawStatus >= 500 ? "External Service Error" : "Client Error",
      cleanMessage: rawMessage,
      rawMessage,
      howToFix: rawStatus >= 500 ? "External service failed. Check service health." : undefined,
    };
  }

  // 7. Generic Unhandled Server Error
  return {
    statusCode: 500,
    category: "Server Error",
    cleanMessage: appConfig.isProduction
      ? "Internal server error. Please try again in a moment."
      : rawMessage || "Internal server error",
    rawMessage,
    howToFix: "Check server stack trace and logs for unexpected runtime exceptions.",
  };
};

export const errorMiddleware = (
  error: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  const resolved = resolveErrorInfo(error, req);
  const { statusCode, category, cleanMessage, rawMessage, howToFix, errors } = resolved;

  // Log clearly to terminal console with exact status code and details
  const methodPath = `${req.method} ${req.path}`;
  const stack = error.stack ?? "No stack trace available";

  if (statusCode >= 500) {
    console.error(
      `\n================================================================================\n` +
      `[${category}] ❌ HTTP ${statusCode} — ${methodPath}\n` +
      `  Status Code: ${statusCode}\n` +
      `  Error:       ${cleanMessage}\n` +
      (howToFix ? `  HOW TO FIX:  ${howToFix}\n` : "") +
      (rawMessage !== cleanMessage ? `  Raw Message: ${truncate(rawMessage, 300)}\n` : "") +
      `  Stack Trace:\n${truncate(stack, 800)}\n` +
      `================================================================================\n`
    );
  } else if (statusCode === 402 || statusCode === 429) {
    console.warn(
      `\n[${category}] ⚠️ HTTP ${statusCode} — ${methodPath}\n` +
      `  Status Code: ${statusCode}\n` +
      `  Error:       ${cleanMessage}\n` +
      (howToFix ? `  HOW TO FIX:  ${howToFix}\n` : "") +
      (rawMessage !== cleanMessage ? `  Raw Details: ${truncate(rawMessage, 300)}\n` : "")
    );
  } else if (statusCode === 401 || statusCode === 403 || statusCode === 404) {
    console.warn(
      `[${category}] ⚠️ HTTP ${statusCode} — ${methodPath}: ${cleanMessage}` +
      (howToFix ? ` (HOW TO FIX: ${howToFix})` : "")
    );
  } else {
    console.warn(`[${category}] ⚠️ HTTP ${statusCode} — ${methodPath}: ${cleanMessage}`);
  }

  // Also log via structured logger
  logger.error(`[error.middleware] HTTP ${statusCode} ${methodPath}`, {
    statusCode,
    category,
    message: cleanMessage,
    raw: truncate(rawMessage, 200),
  });

  // Alert Discord with the EXACT SAME status code, category, and clean error message
  if (statusCode >= 500 || statusCode === 402 || statusCode === 404 || statusCode === 429) {
    void teamsAlerter.notify({
      context: `${req.method} ${req.path}`,
      error: new Error(cleanMessage),
      extras: {
        "Status Code": String(statusCode),
        "Category": category,
        "Error Details": truncate(cleanMessage, 300),
        ...(howToFix ? { "HOW TO FIX": truncate(howToFix, 250) } : {}),
        "User Agent": req.headers["user-agent"] ?? "unknown",
      },
    });
  }

  // Send exact status code and consistent JSON body to the client
  const responseBody: ErrorResponseBody = {
    success: false,
    statusCode,
    message: cleanMessage,
    error: cleanMessage,
  };

  if (errors && errors.length > 0) {
    responseBody.errors = errors;
  }

  if (howToFix && !appConfig.isProduction) {
    responseBody.howToFix = howToFix;
  }

  res.status(statusCode).json(responseBody);
};

export const notFoundMiddleware = (req: Request, res: Response): void => {
  const message = `API route not found: ${req.method} ${req.path}. Please check the URL and HTTP method.`;
  res.status(404).json({
    success: false,
    statusCode: 404,
    message,
    error: message,
  });
};
