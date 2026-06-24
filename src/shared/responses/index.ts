import { Response } from "express";

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: Array<{ field: string; message: string }>;
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
  errors?: Array<{ field: string; message: string }>
): void => {
  const body: ApiResponse = { success: false, message };
  if (errors && errors.length > 0) body.errors = errors;
  res.status(statusCode).json(body);
};
