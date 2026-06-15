import { Request, Response, NextFunction } from "express";
import { auth } from "../config/firebase";
import { logger } from "../shared/logger";

const verifyToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    res.status(401).json({ success: false, message: "Authorization token missing" });
    return;
  }

  try {
    req.user = await auth.verifyIdToken(token);
    logger.debug(`[auth.middleware] verified uid=${req.user.uid}`);
    next();
  } catch {
    logger.warn("[auth.middleware] invalid or expired token");
    res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

export default verifyToken;
