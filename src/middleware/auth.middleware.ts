import { Request, Response, NextFunction } from "express";
import { auth } from "../config/firebase";
import { AppError } from "../shared/utils";
import { logger } from "../shared/logger";
import { mapFirebaseAuthError } from "../shared/errors";

const verifyToken = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    next(
      new AppError(
        401,
        "Authorization token is missing. Please log in and send a Bearer token in the Authorization header."
      )
    );
    return;
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    next(
      new AppError(
        401,
        "Authorization token is missing. Please log in and send a Bearer token in the Authorization header."
      )
    );
    return;
  }

  try {
    req.user = await auth.verifyIdToken(token);
    logger.debug(`[auth.middleware] verified uid=${req.user.uid}`);
    next();
  } catch (error) {
    const code = (error as { code?: string }).code;
    logger.warn("[auth.middleware] invalid or expired token", { code });
    next(new AppError(401, mapFirebaseAuthError(code)));
  }
};

export default verifyToken;
