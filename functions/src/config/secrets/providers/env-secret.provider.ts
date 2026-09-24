import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { ServiceAccount } from "firebase-admin/app";
import type { AppSecrets, FirebaseCredentials } from "../secret.types";
import { isCloudRuntime } from "../../../shared/runtime";
import type { SecretProvider } from "./secret-provider.interface";
import { firestoreConfigService } from "../../firestore-config.service";

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
  const configured = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (configured && existsSync(configured)) return configured;

  const targetProjectId = (
    process.env.FB_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    ""
  ).trim();

  const searchDirs = [
    process.cwd(),
    resolve(process.cwd(), ".."),
    resolve(__dirname, "../../../../"),
    resolve(__dirname, "../../../"),
  ];

  const filenames: string[] = [];
  if (targetProjectId) {
    filenames.push(
      `firebase-service-account.${targetProjectId}.json`,
      `service-account.${targetProjectId}.json`
    );
    if (targetProjectId === "interview-89e09" || targetProjectId.includes("dev")) {
      filenames.push(
        "firebase-service-account.dev.json",
        "service-account.dev.json"
      );
    }
  }
  filenames.push("firebase-service-account.json", "service-account.json");

  for (const dir of searchDirs) {
    for (const name of filenames) {
      const filePath = resolve(dir, name);
      if (existsSync(filePath)) {
        try {
          const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
          const saProjectId = parsed.projectId ?? parsed.project_id;
          if (!targetProjectId || !saProjectId || saProjectId === targetProjectId) {
            return filePath;
          }
        } catch {
          // ignore
        }
      }
    }
  }

  return null;
};

const loadFirebaseCredentials = (): FirebaseCredentials => {
  if (isCloudRuntime()) {
    return {
      projectId:
        process.env.GCLOUD_PROJECT?.trim() ||
        process.env.FIREBASE_PROJECT_ID?.trim() ||
        "",
      clientEmail: "",
      privateKey: "",
    };
  }

  const saBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();

  if (saBase64 || saJson) {
    try {
      const rawString = saBase64
        ? Buffer.from(saBase64, "base64").toString("utf-8")
        : saJson!;
      const parsed = JSON.parse(rawString);
      const projectId = parsed.projectId ?? parsed.project_id;
      const clientEmail = parsed.clientEmail ?? parsed.client_email;
      const privateKey = parsed.privateKey ?? parsed.private_key;

      if (projectId && clientEmail && privateKey) {
        return {
          projectId,
          clientEmail,
          privateKey: normalizePrivateKey(privateKey),
        };
      }
    } catch (e) {
      console.error("[EnvSecretProvider] Failed to parse FIREBASE_SERVICE_ACCOUNT env var:", e);
    }
  }

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
      "FIREBASE_PRIVATE_KEY, or FIREBASE_SERVICE_ACCOUNT_BASE64, or provide GOOGLE_APPLICATION_CREDENTIALS / firebase-service-account.json"
  );
};

/**
 * Loads secrets from Firestore config documents or environment variables (local dev, Docker, CI).
 */
export class EnvSecretProvider implements SecretProvider {
  load(): AppSecrets {
    const genaiConfig = firestoreConfigService.getGenAIConfig();
    const firebaseConfig = firestoreConfigService.getFirebaseConfig();
    const smtpConfig = firestoreConfigService.getSMTPConfig();

    const geminiApiKey = (genaiConfig.apiKey || "").trim();
    const firebaseApiKey = (firebaseConfig.apiKey || "").trim();
    const smtpPassword = (smtpConfig.pass || "").trim() || undefined;

    return {
      geminiApiKey,
      firebaseApiKey,
      firebase: loadFirebaseCredentials(),
      ...(smtpPassword && { smtpPassword }),
    };
  }
}
