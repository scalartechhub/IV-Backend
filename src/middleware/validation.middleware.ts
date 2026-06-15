import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { logger } from "../shared/logger";

export const validate =
  (schema: ZodSchema, target: "body" | "query" | "params" = "body") =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      logger.debug("[validation.middleware] validation failed", result.error.flatten());
      res.status(400).json({
        success: false,
        message: "Validation failed",
        error: result.error.flatten().fieldErrors,
      });
      return;
    }

    req[target] = result.data;
    next();
  };
