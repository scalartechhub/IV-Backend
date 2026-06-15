import { Request, Response } from "express";
import * as authService from "./auth.service";
import { sendSuccess, sendCreated, sendError } from "../../shared/responses";
import { logger } from "../../shared/logger";
import { AppError } from "../../shared/utils";
import type { User, UserResponse } from "./auth.types";

const toUserResponse = (user: User): UserResponse => ({
  uid: user.uid,
  name: user.name,
  ...(user.email && { email: user.email }),
  ...(user.phoneNumber && { phoneNumber: user.phoneNumber }),
  ...(user.photoURL && { photoURL: user.photoURL }),
  provider: user.provider,
  isActive: user.isActive,
});

const handleError = (res: Response, error: unknown, context: string): void => {
  logger.error(`[${context}]`, error);
  if (error instanceof AppError) {
    sendError(res, error.message, error.statusCode, error.details);
  } else {
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    sendError(res, message, 400);
  }
};

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user, customToken } = await authService.register(req.body);
    sendCreated(res, { ...toUserResponse(user), customToken }, "Registration successful");
  } catch (error) {
    handleError(res, error, "register");
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user, idToken } = await authService.login(req.body);
    sendSuccess(res, { ...toUserResponse(user), idToken }, "Login successful");
  } catch (error) {
    handleError(res, error, "login");
  }
};

export const googleLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = await authService.googleLogin(req.body);
    sendSuccess(res, toUserResponse(user), "Google authentication successful");
  } catch (error) {
    handleError(res, error, "googleLogin");
  }
};

export const githubLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = await authService.githubLogin(req.body);
    sendSuccess(res, toUserResponse(user), "GitHub authentication successful");
  } catch (error) {
    handleError(res, error, "githubLogin");
  }
};

export const phoneLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = await authService.phoneLogin(req.body);
    sendSuccess(res, toUserResponse(user), "Phone authentication successful");
  } catch (error) {
    handleError(res, error, "phoneLogin");
  }
};

export const getCurrentUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await authService.getCurrentUser(req.user!.uid);
    sendSuccess(res, toUserResponse(user));
  } catch (error) {
    handleError(res, error, "getCurrentUser");
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    await authService.logout(req.user!.uid);
    sendSuccess(res, null, "Successfully logged out");
  } catch (error) {
    handleError(res, error, "logout");
  }
};
