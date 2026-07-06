import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
import { logger } from "../shared/logger";
import { AppError } from "../shared/utils";
import { buildValidationMessage, formatZodErrors } from "../shared/errors";

export const validate =
  (schema: ZodSchema, target: "body" | "query" | "params" = "body") =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const errors = formatZodErrors(result.error);
      logger.debug("[validation.middleware] validation failed", errors);
      next(new AppError(400, buildValidationMessage(errors), errors));
      return;
    }

    if (target === "body") {
      req.body = result.data;
      next();
      return;
    }

    // Express 5 exposes read-only query/params getters — shadow with parsed values.
    Object.defineProperty(req, target, {
      value: result.data,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    next();
  };
