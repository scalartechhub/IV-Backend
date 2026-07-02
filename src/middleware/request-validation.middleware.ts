import { NextFunction, Request, Response } from "express";
import { validationResult } from "express-validator";
import { AppError } from "../shared/utils";

export const checkRequestValidation = (req: Request, _res: Response, next: NextFunction): void => {
  const result = validationResult(req);
  if (result.isEmpty()) {
    next();
    return;
  }

  const errors = result.array().map((issue) => ({
    field: issue.type === "field" ? issue.path : "request",
    message: issue.msg,
  }));

  next(new AppError(400, "Request validation failed", errors));
};
