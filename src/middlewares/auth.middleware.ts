import { Request, Response, NextFunction } from "express";
import { auth } from "../config/firebase";

const verifyToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      res.status(401).json({ success: false, message: "Authorization token missing" });
      return;
    }

    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;

    next();
  } catch {
    res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

export default verifyToken;
