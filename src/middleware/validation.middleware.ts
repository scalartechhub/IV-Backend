import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
import { logger } from "../shared/logger";
import { AppError } from "../shared/utils";

export const validate =
  (schema: ZodSchema, target: "body" | "query" | "params" = "body") =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      logger.debug("[validation.middleware] validation failed", result.error.flatten());
      next(
        new AppError(400, "Validation failed", result.error.flatten().fieldErrors)
      );
      return;
    }

    req[target] = result.data;
    next();
  };
