import { Request, Response } from "express";
import * as authService from "../services/auth.service";
import {
  LoginInput,
  OAuthTokenInput,
  RegisterInput,
  User,
  UserResponse,
} from "../models/user.model";

const toUserResponse = (user: User): UserResponse => ({
  uid: user.uid,
  name: user.name,
  ...(user.email && { email: user.email }),
  ...(user.phoneNumber && { phoneNumber: user.phoneNumber }),
  ...(user.photoURL && { photoURL: user.photoURL }),
  provider: user.provider,
  isActive: user.isActive,
});

export const register = async (
  req: Request<object, object, RegisterInput>,
  res: Response
): Promise<void> => {
  try {
    const { user, customToken } = await authService.register(req.body);
    res.status(201).json({
      success: true,
      message: "Registration successful",
      data: { ...toUserResponse(user), customToken },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed";
    console.error("[register]", message);
    res.status(400).json({ success: false, message });
  }
};

export const login = async (
  req: Request<object, object, LoginInput>,
  res: Response
): Promise<void> => {
  try {
    const { user, idToken } = await authService.login(req.body);
    res.status(200).json({
      success: true,
      message: "Login successful",
      data: { ...toUserResponse(user), idToken },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login failed";
    console.error("[login]", message);
    res.status(401).json({ success: false, message });
  }
};

export const googleLogin = async (
  req: Request<object, object, OAuthTokenInput>,
  res: Response
): Promise<void> => {
  try {
    const { user } = await authService.googleLogin(req.body);
    res.status(200).json({
      success: true,
      message: "Google authentication successful",
      data: toUserResponse(user),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google login failed";
    console.error("[googleLogin]", message);
    res.status(401).json({ success: false, message });
  }
};

export const githubLogin = async (
  req: Request<object, object, OAuthTokenInput>,
  res: Response
): Promise<void> => {
  try {
    const { user } = await authService.githubLogin(req.body);
    res.status(200).json({
      success: true,
      message: "GitHub authentication successful",
      data: toUserResponse(user),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub login failed";
    console.error("[githubLogin]", message);
    res.status(401).json({ success: false, message });
  }
};

export const phoneLogin = async (
  req: Request<object, object, OAuthTokenInput>,
  res: Response
): Promise<void> => {
  try {
    const { user } = await authService.phoneLogin(req.body);
    res.status(200).json({
      success: true,
      message: "Phone authentication successful",
      data: toUserResponse(user),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Phone login failed";
    console.error("[phoneLogin]", message);
    res.status(401).json({ success: false, message });
  }
};

export const getCurrentUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await authService.getCurrentUser(req.user!.uid);
    res.status(200).json({ success: true, data: toUserResponse(user) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "User not found";
    console.error("[getCurrentUser]", message);
    res.status(404).json({ success: false, message });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    await authService.logout(req.user!.uid);
    res.status(200).json({ success: true, message: "Successfully logged out" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Logout failed";
    console.error("[logout]", message);
    res.status(500).json({ success: false, message });
  }
};
