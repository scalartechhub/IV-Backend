import { Timestamp } from "firebase-admin/firestore";
import type { ResumeAnalysis } from "../interview/interview.types";
import type { DifficultyLevel, InterviewType } from "../../shared/constants";
import { PLAN_IDS } from "../../constants/payment.constants";
import { SUBSCRIPTION_STATUS } from "../../constants/payment.constants";

export type AuthProvider = "email" | "google" | "github" | "phone";

export interface UserInterviewSettings {
  domain: string;
  category: string;
  specification: string;
  targetRole: string;
  difficultyLevel: DifficultyLevel;
  interviewType: InterviewType;
  durationMinutes: number;
  questionCount: number;
  experienceLevel?: string;
  aiPersonality?: string;
  techStacks?: Array<{ label: string }>;
}

export interface UserNotificationPreferences {
  feedbackReports: boolean;
  interviewReminders: boolean;
}

export interface UserPreferences {
  interview?: UserInterviewSettings;
  notifications?: UserNotificationPreferences;
}

export interface UserStats {
  totalInterviews: number;
  completedInterviews: number;
  averageScore: number;
  bestScore: number;
}

export interface UserSubscription {
  plan: string;
  status?: string;
  expiresAt?: string | null;
  purchaseDate?: string;
  interviewCredits?: number;
}

export interface UserResumeAnalysisEntry {
  no: number;
  url?: string;
  parsed: ResumeAnalysis;
  uploadedAt: Timestamp;
}

export interface UserResume {
  url?: string;
  analyses: UserResumeAnalysisEntry[];
}

export interface UserProfileDetails {
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  designation?: string;
  company?: string;
  industry?: string;
  yearsOfExperience?: string;
  location?: { country?: string; state?: string; city?: string };
  bio?: string;
  skills?: Array<{ name: string }>;
  experiences?: Array<{
    id?: number;
    title: string;
    company: string;
    period?: string;
    description?: string;
  }>;
}

export interface User {
  uid: string;
  email?: string;
  displayName: string;
  photoURL?: string;
  provider?: AuthProvider;
  role?: "candidate" | "admin";
  isActive?: boolean;
  profile?: UserProfileDetails;
  preferences?: UserPreferences;
  stats?: UserStats;
  subscription?: UserSubscription;
  resume?: UserResume;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastLoginAt?: Timestamp;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  interview: {
    domain: "Software Engineering",
    category: "Backend",
    specification: "Node.js",
    targetRole: "Backend Developer",
    difficultyLevel: "medium",
    interviewType: "technicalInterview",
    durationMinutes: 30,
    questionCount: 10,
  },
  notifications: {
    interviewReminders: true,
    feedbackReports: true,
  },
};

export const DEFAULT_USER_SUBSCRIPTION: UserSubscription = {
  plan: PLAN_IDS.FREE,
  status: SUBSCRIPTION_STATUS.ACTIVE,
  interviewCredits: 3,
};

export interface UserResponse {
  uid: string;
  displayName: string;
  email?: string;
  photoURL?: string;
  provider?: AuthProvider;
  role?: string;
  isActive?: boolean;
  profile?: UserProfileDetails;
  preferences?: UserPreferences;
  stats?: UserStats;
  subscription?: UserSubscription;
  resume?: UserResume;
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
