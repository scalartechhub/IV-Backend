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

export interface UserResponse {
  uid: string;
  name: string;
  email?: string;
  phoneNumber?: string;
  photoURL?: string;
  provider: AuthProvider;
  isActive: boolean;
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

// ─── Extended Firestore user profile (candidate app) ─────────────────────────

export interface UserSkill {
  name: string;
  isCustom?: boolean;
}

export interface UserExperienceEntry {
  id?: number;
  company: string;
  title: string;
  period?: string;
  description?: string;
  iconVariant?: string;
}

export interface FavoriteTechStack {
  label: string;
  isCustom?: boolean;
}

export interface InterviewPreferences {
  aiPersonality?: string;
  difficultyLevel?: string;
  favoriteTechStacks?: FavoriteTechStack[];
}

export interface ProfessionalDetails {
  company?: string;
  designation?: string;
  industry?: string;
  yearsOfExperience?: string;
}

export interface UserProfile {
  uid: string;
  name?: string;
  email?: string;
  skills?: UserSkill[];
  experiences?: UserExperienceEntry[];
  interviewPreferences?: InterviewPreferences;
  professionalDetails?: ProfessionalDetails;
  professionalSummary?: { bio?: string };
  provider?: AuthProvider;
  role?: string;
}
