import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { AppError } from "../shared/utils";
import { logger } from "../shared/logger";

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
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      ...(error.details !== undefined && { error: error.details }),
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    let message = error.message;
    if (error.code === "LIMIT_FILE_SIZE") {
      message = "File too large. Maximum allowed size is 10MB.";
    } else if (error.code === "LIMIT_UNEXPECTED_FILE") {
      message = 'Unexpected field. Use form-data key "file" (type: File).';
    }

    res.status(400).json({ success: false, message });
    return;
  }

  if (error.message === "Unexpected field") {
    res.status(400).json({
      success: false,
      message: 'Unexpected field. Use form-data key "file" (type: File).',
    });
    return;
  }

  if (error.message?.toLowerCase().includes("only pdf")) {
    res.status(400).json({ success: false, message: error.message });
    return;
  }

  if (error.message?.includes("FAILED_PRECONDITION") && error.message?.includes("index")) {
    res.status(503).json({
      success: false,
      message: "Database index required. Restart the server after pulling latest code, or create the index from the Firebase Console link in server logs.",
    });
    return;
  }

  res.status(500).json({
    success: false,
    message:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : error.message,
  });
};

export const notFoundMiddleware = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
};
