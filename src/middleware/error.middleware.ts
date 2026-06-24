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
    sendErrorResponse(res, error.statusCode, error.message, error.errors);
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
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

    sendErrorResponse(res, 400, formatMulterError(error, fieldHint));
    return;
  }

  if (error.message === "Unexpected field") {
    const isInterviewDocuments = req.path.includes("create-with-documents");
    sendErrorResponse(
      res,
      400,
      isInterviewDocuments
        ? 'Unexpected file field. Use form-data keys "resume" and/or "jd" (type: File).'
        : 'Unexpected file field. Use form-data key "file" (type: File).'
    );
    return;
  }

  if (error.message?.toLowerCase().includes("only pdf")) {
    sendErrorResponse(res, 400, "Only PDF files are allowed. Please upload a .pdf file.");
    return;
  }

  if (error.message?.includes("FAILED_PRECONDITION") && error.message?.includes("index")) {
    sendErrorResponse(
      res,
      503,
      "Database index is missing. Please contact support or try again after the server is updated."
    );
    return;
  }

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
