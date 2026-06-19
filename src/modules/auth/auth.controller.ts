import { Request, Response } from "express";
import * as authService from "./auth.service";
import { sendSuccess, sendCreated } from "../../shared/responses";
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

export const register = async (req: Request, res: Response): Promise<void> => {
  const { user, customToken } = await authService.register(req.body);
  sendCreated(res, { ...toUserResponse(user), customToken }, "Registration successful");
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { user, idToken } = await authService.login(req.body);
  sendSuccess(res, { ...toUserResponse(user), idToken }, "Login successful");
};

export const googleLogin = async (req: Request, res: Response): Promise<void> => {
  const { user } = await authService.googleLogin(req.body);
  sendSuccess(res, toUserResponse(user), "Google authentication successful");
};

export const githubLogin = async (req: Request, res: Response): Promise<void> => {
  const { user } = await authService.githubLogin(req.body);
  sendSuccess(res, toUserResponse(user), "GitHub authentication successful");
};

export const phoneLogin = async (req: Request, res: Response): Promise<void> => {
  const { user } = await authService.phoneLogin(req.body);
  sendSuccess(res, toUserResponse(user), "Phone authentication successful");
};

export const getCurrentUser = async (req: Request, res: Response): Promise<void> => {
  const user = await authService.getCurrentUser(req.user!.uid);
  sendSuccess(res, toUserResponse(user));
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  await authService.logout(req.user!.uid);
  sendSuccess(res, null, "Successfully logged out");
};
