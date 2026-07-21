import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { appConfig } from "../config/app.config";
import { AppError } from "../shared/utils";
import { logger } from "../shared/logger";
import {
  formatMulterError,
  type ApiFieldError,
} from "../shared/errors";

interface ErrorResponseBody {
  success: false;
  message: string;
  errors?: ApiFieldError[];
}

const sendErrorResponse = (
  res: Response,
  statusCode: number,
  message: string,
  errors?: ApiFieldError[]
): void => {
  const body: ErrorResponseBody = { success: false, message };
  if (errors && errors.length > 0) {
    body.errors = errors;
  }
  res.status(statusCode).json(body);
};

export const errorMiddleware = (
  error: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  logger.error(`[error.middleware] ${req.method} ${req.path}`, {
    name: error.name,
    message: error.message,
  });

  if (error instanceof AppError) {
    const statusCode = error.statusCode;

    if (statusCode === 401) {
      console.error(
        `[Auth] ❌ Unauthorized — ${req.method} ${req.path}\n` +
        `  HOW TO FIX: Make sure you are sending a valid Firebase ID token in the Authorization header.\n` +
        `  Format: "Authorization: Bearer <your-token>"\n` +
        `  Message: ${error.message}`
      );
    } else if (statusCode === 403) {
      console.error(
        `[Auth] ❌ Forbidden — ${req.method} ${req.path}\n` +
        `  HOW TO FIX: The user does not have permission for this action.\n` +
        `  Check if the user's plan/subscription allows this feature.\n` +
        `  Message: ${error.message}`
      );
    } else if (statusCode === 402) {
      console.error(
        `[Payment/Quota] ❌ Payment or quota error — ${req.method} ${req.path}\n` +
        `  HOW TO FIX: Check the Gemini API billing or the user's subscription plan.\n` +
        `  Message: ${error.message}`
      );
    } else if (statusCode === 429) {
      console.warn(
        `[RateLimit] ⚠️ Too many requests — ${req.method} ${req.path}\n` +
        `  HOW TO FIX: Slow down request frequency or upgrade the Gemini API plan.\n` +
        `  Message: ${error.message}`
      );
    } else if (statusCode === 502) {
      console.error(
        `[AI] ❌ AI response error — ${req.method} ${req.path}\n` +
        `  WHAT THIS MEANS: ${error.message}\n` +
        `  HOW TO FIX:\n` +
        `  1. Retry the request — AI responses can fail temporarily.\n` +
        `  2. Check GEMINI_API_KEY and quota in your .env file.\n` +
        `  3. Look above in server logs for "[AI Response]" or "[Gemini]" details.`
      );
    } else if (statusCode >= 500) {
      console.error(
        `[Server] ❌ Internal error (${statusCode}) — ${req.method} ${req.path}\n` +
        `  Message: ${error.message}\n` +
        `  Stack: ${error.stack ?? "no stack"}`
      );
    }

    sendErrorResponse(res, statusCode, error.message, error.errors);
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    console.warn(
      `[Request] ⚠️ Invalid JSON body — ${req.method} ${req.path}\n` +
      `  HOW TO FIX: Check the request body is valid JSON.\n` +
      `  Tip: Use a JSON validator at https://jsonlint.com`
    );
    sendErrorResponse(
      res,
      400,
      "Invalid JSON in request body. Please check the request format and try again."
    );
    return;
  }

  if (error instanceof multer.MulterError) {
    const isInterviewDocuments = req.path.includes("create-with-documents");
    const fieldHint = isInterviewDocuments
      ? 'Unexpected file field. Use form-data keys "resume" and/or "jd" (type: File).'
      : 'Unexpected file field. Use form-data key "file" (type: File).';

    console.warn(
      `[Upload] ⚠️ File upload error (${error.code}) — ${req.method} ${req.path}\n` +
      `  HOW TO FIX:\n` +
      `  - LIMIT_FILE_SIZE: File exceeds 10 MB. Compress or reduce the file size.\n` +
      `  - LIMIT_FILE_COUNT: Too many files. Send only the allowed file fields.\n` +
      `  - LIMIT_UNEXPECTED_FILE: Wrong field name. ${fieldHint}\n` +
      `  Error: ${error.message}`
    );
    sendErrorResponse(res, 400, formatMulterError(error, fieldHint));
    return;
  }

  if (error.message === "Unexpected field") {
    const isInterviewDocuments = req.path.includes("create-with-documents");
    const hint = isInterviewDocuments
      ? 'Unexpected file field. Use form-data keys "resume" and/or "jd" (type: File).'
      : 'Unexpected file field. Use form-data key "file" (type: File).';
    console.warn(
      `[Upload] ⚠️ Unexpected form-data field — ${req.method} ${req.path}\n` +
      `  HOW TO FIX: ${hint}`
    );
    sendErrorResponse(res, 400, hint);
    return;
  }

  if (error.message?.toLowerCase().includes("only pdf")) {
    console.warn(
      `[Upload] ⚠️ Non-PDF file uploaded — ${req.method} ${req.path}\n` +
      `  HOW TO FIX: Only .pdf files are accepted. Convert your file to PDF before uploading.`
    );
    sendErrorResponse(res, 400, "Only PDF files are allowed. Please upload a .pdf file.");
    return;
  }

  if (error.message?.includes("FAILED_PRECONDITION") && error.message?.includes("index")) {
    console.error(
      `[Database] ❌ Firestore index missing — ${req.method} ${req.path}\n` +
      `  HOW TO FIX:\n` +
      `  1. Open the Firebase Console and go to Firestore → Indexes.\n` +
      `  2. Create the missing composite index shown in the error below.\n` +
      `  3. Wait for the index to finish building (usually 1-2 minutes).\n` +
      `  Raw error: ${error.message}`
    );
    sendErrorResponse(
      res,
      503,
      "A database index is still being set up. Please try again in a few minutes."
    );
    return;
  }

  console.error(
    `[Server] ❌ Unhandled error — ${req.method} ${req.path}\n` +
    `  HOW TO FIX: This is an unexpected error. Check the stack trace below for details.\n` +
    `  Error: ${error.message}\n` +
    `  Stack: ${error.stack ?? "no stack available"}`
  );

  sendErrorResponse(
    res,
    500,
    appConfig.isProduction
      ? "Something went wrong on our side. Please try again in a moment."
      : error.message || "Internal server error"
  );
};

export const notFoundMiddleware = (req: Request, res: Response): void => {
  sendErrorResponse(
    res,
    404,
    `API route not found: ${req.method} ${req.path}. Please check the URL and HTTP method.`
  );
};
