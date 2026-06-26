import { Request, Response } from "express";
import * as authService from "./auth.service";
import { sendSuccess, sendCreated } from "../../shared/responses";
import type { User, UserResponse } from "./auth.types";

const toUserResponse = (user: User): UserResponse => ({
  uid: user.uid,
  displayName: user.displayName ?? user.name ?? "",
  ...(user.email && { email: user.email }),
  ...(user.photoURL && { photoURL: user.photoURL }),
  ...(user.currentRole && { currentRole: user.currentRole }),
  ...(user.experience !== undefined && { experience: user.experience }),
  ...(user.technologies && { technologies: user.technologies }),
  ...(user.resumeUrl && { resumeUrl: user.resumeUrl }),
  ...(user.resumeAnalyses && { resumeAnalyses: user.resumeAnalyses }),
  ...(user.provider && { provider: user.provider }),
  ...(user.isActive !== undefined && { isActive: user.isActive }),
});

export const register = async (req: Request, res: Response): Promise<void> => {
  const { user } = await authService.register(req.body);
  sendCreated(res, toUserResponse(user), "Registration successful. Please login to get your token.");
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { user, idToken } = await authService.login(req.body);
  sendSuccess(res, { ...toUserResponse(user), idToken }, "Login successful");
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  await authService.logout(req.user!.uid);
  sendSuccess(res, null, "Successfully logged out");
};
