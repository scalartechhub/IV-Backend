import { Response } from "express";

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: unknown;
}

export const sendSuccess = <T>(
  res: Response,
  data: T,
  message = "Success",
  statusCode = 200
): void => {
  res.status(statusCode).json({ success: true, message, data } satisfies ApiResponse<T>);
};

export const sendCreated = <T>(res: Response, data: T, message = "Created successfully"): void => {
  sendSuccess(res, data, message, 201);
};

export const sendError = (
  res: Response,
  message: string,
  statusCode = 500,
  error?: unknown
): void => {
  const body: ApiResponse = { success: false, message };
  if (error !== undefined) body.error = error;
  res.status(statusCode).json(body);
};
