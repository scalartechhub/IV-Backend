import { Request, Response } from "express";
import * as authService from "./auth.service";
import { sendSuccess, sendCreated } from "../../shared/responses";
import type { User, UserResponse } from "./auth.types";

const toUserResponse = (user: User): UserResponse => ({
  uid: user.uid,
  displayName: user.displayName,
  ...(user.email && { email: user.email }),
  ...(user.photoURL && { photoURL: user.photoURL }),
  ...(user.provider && { provider: user.provider }),
  ...(user.role && { role: user.role }),
  ...(user.isActive !== undefined && { isActive: user.isActive }),
  ...(user.profile && { profile: user.profile }),
  ...(user.preferences && { preferences: user.preferences }),
  ...(user.stats && { stats: user.stats }),
  ...(user.interview && { interview: user.interview }),
  ...(user.subscription && { subscription: user.subscription }),
  ...(user.resume && { resume: user.resume }),
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
