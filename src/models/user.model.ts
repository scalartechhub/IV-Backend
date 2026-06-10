import { Timestamp } from "firebase-admin/firestore";

export type AuthProvider = "email" | "google" | "github" | "phone";

export interface User {
  uid: string;
  name: string;
  email?: string;
  phoneNumber?: string;
  photoURL?: string;
  provider: AuthProvider;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface OAuthTokenInput {
  idToken: string;
}

export interface UserResponse {
  uid: string;
  name: string;
  email?: string;
  phoneNumber?: string;
  photoURL?: string;
  provider: AuthProvider;
  isActive: boolean;
}

export interface RegisterResult {
  user: User;
  customToken: string;
}

export interface LoginResult {
  user: User;
  idToken: string;
}

export interface OAuthResult {
  user: User;
}
