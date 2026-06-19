import { Request, Response, NextFunction } from "express";
import { auth } from "../config/firebase";
import { AppError } from "../shared/utils";
import { logger } from "../shared/logger";

const verifyToken = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    next(new AppError(401, "Authorization token missing"));
    return;
  }

  try {
    req.user = await auth.verifyIdToken(token);
    logger.debug(`[auth.middleware] verified uid=${req.user.uid}`);
    next();
  } catch {
    logger.warn("[auth.middleware] invalid or expired token");
    next(new AppError(401, "Invalid or expired token"));
  }
};

export default verifyToken;
