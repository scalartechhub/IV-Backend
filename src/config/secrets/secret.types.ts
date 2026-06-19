/** Firebase Admin service account credentials (never log these values). */
export interface FirebaseCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/** All application secrets loaded once at startup and cached in memory. */
export interface AppSecrets {
  geminiApiKey: string;
  firebaseApiKey: string;
  firebase: FirebaseCredentials;
  jwtSecret?: string;
  smtpPassword?: string;
}

export const REQUIRED_SECRET_KEYS = [
  "GEMINI_API_KEY",
  "FIREBASE_API_KEY",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
] as const;

export type RequiredSecretKey = (typeof REQUIRED_SECRET_KEYS)[number];
