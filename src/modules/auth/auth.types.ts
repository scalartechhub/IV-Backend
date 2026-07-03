import { Timestamp } from "firebase-admin/firestore";
import type { ResumeAnalysis } from "../interview/interview.types";
import type { DifficultyLevel, InterviewType, SubscriptionPlan } from "../../shared/constants";

export type AuthProvider = "email";

export interface UserInterviewSettings {
  difficultyLevel: DifficultyLevel;
  interviewType: InterviewType;
  durationMinutes: number;
  questionCount: number;
}

export interface UserNotificationPreferences {
  feedbackReports: boolean;
  interviewReminders: boolean;
}

export interface UserSubscription {
  plan: SubscriptionPlan;
  status?: string;
  expiresAt?: string;
  purchaseDate?: string;
  interviewCredits?: number;
}

export interface User {
  uid: string;
  email?: string;
  displayName: string;
  photoURL?: string;
  currentRole?: string;
  experience?: number;
  technologies?: string[];
  resumeUrl?: string;
  resumeAnalyses?: UserResumeAnalysisEntry[];
  settings?: UserInterviewSettings;
  subscription?: UserSubscription;
  /** @deprecated Use displayName — kept for auth backward compatibility */
  name?: string;
  phoneNumber?: string;
  provider?: AuthProvider;
  isActive?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface UserResumeAnalysisEntry {
  no: number;
  resumeUrl?: string;
  analysis: ResumeAnalysis;
  uploadedAt: Timestamp;
}

export interface UserResponse {
  uid: string;
  displayName: string;
  email?: string;
  phoneNumber?: string;
  photoURL?: string;
  currentRole?: string;
  experience?: number;
  technologies?: string[];
  resumeUrl?: string;
  resumeAnalyses?: UserResumeAnalysisEntry[];
  provider?: AuthProvider;
  isActive?: boolean;
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

export interface RegisterResult {
  user: User;
}

export interface LoginResult {
  user: User;
  idToken: string;
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
  displayName?: string;
  name?: string;
  email?: string;
  currentRole?: string;
  experience?: number;
  technologies?: string[];
  skills?: UserSkill[];
  experiences?: UserExperienceEntry[];
  interviewPreferences?: InterviewPreferences;
  professionalDetails?: ProfessionalDetails;
  professionalSummary?: { bio?: string };
  provider?: AuthProvider;
  role?: string;
}
