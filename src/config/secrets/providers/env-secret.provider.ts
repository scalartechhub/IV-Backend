import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { ServiceAccount } from "firebase-admin/app";
import type { AppSecrets, FirebaseCredentials } from "../secret.types";
import type { SecretProvider } from "./secret-provider.interface";

const normalizePrivateKey = (key: string): string => key.replace(/\\n/g, "\n");

const readServiceAccountFile = (filePath: string): FirebaseCredentials => {
  const raw = JSON.parse(readFileSync(filePath, "utf-8")) as ServiceAccount & {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  };

  const projectId = raw.projectId ?? raw.project_id;
  const clientEmail = raw.clientEmail ?? raw.client_email;
  const privateKey = raw.privateKey ?? raw.private_key;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      `Service account file at ${filePath} is missing project_id, client_email, or private_key`
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey: normalizePrivateKey(privateKey),
  };
};

const resolveServiceAccountPath = (): string | null => {
  const configured = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (configured && existsSync(configured)) return configured;

  const defaultPath = resolve(process.cwd(), "firebase-service-account.json");
  if (existsSync(defaultPath)) return defaultPath;

  return null;
};

const loadFirebaseCredentials = (): FirebaseCredentials => {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY?.trim();

  if (projectId && clientEmail && privateKeyRaw) {
    return {
      projectId,
      clientEmail,
      privateKey: normalizePrivateKey(privateKeyRaw),
    };
  }

  const filePath = resolveServiceAccountPath();
  if (filePath) {
    return readServiceAccountFile(filePath);
  }

  throw new Error(
    "Firebase credentials not found. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and " +
      "FIREBASE_PRIVATE_KEY, or provide GOOGLE_APPLICATION_CREDENTIALS / firebase-service-account.json"
  );
};

/**
 * Loads secrets from environment variables (local dev, Docker, CI).
 */
export class EnvSecretProvider implements SecretProvider {
  load(): AppSecrets {
    const geminiApiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
    const firebaseApiKey = process.env.FIREBASE_API_KEY?.trim() ?? "";
    const jwtSecret = process.env.JWT_SECRET?.trim() || undefined;
    const smtpPassword = process.env.SMTP_PASSWORD?.trim() || undefined;

    return {
      geminiApiKey,
      firebaseApiKey,
      firebase: loadFirebaseCredentials(),
      ...(jwtSecret && { jwtSecret }),
      ...(smtpPassword && { smtpPassword }),
    };
  }
}
