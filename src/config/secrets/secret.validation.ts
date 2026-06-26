import { isCloudRuntime } from "../../shared/runtime";
import type { AppSecrets } from "./secret.types";
import { REQUIRED_SECRET_KEYS } from "./secret.types";

export class SecretValidationError extends Error {
  constructor(
    message: string,
    public readonly missingKeys: string[]
  ) {
    super(message);
    this.name = "SecretValidationError";
  }
}

export const validateSecrets = (secrets: AppSecrets): void => {
  const missing: string[] = [];

  if (!secrets.geminiApiKey) missing.push("GEMINI_API_KEY");
  if (!secrets.firebaseApiKey) missing.push("FIREBASE_API_KEY");

  if (!isCloudRuntime()) {
    if (!secrets.firebase.projectId) missing.push("FIREBASE_PROJECT_ID");
    if (!secrets.firebase.clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");
    if (!secrets.firebase.privateKey) missing.push("FIREBASE_PRIVATE_KEY");
  }

  if (missing.length === 0) return;

  const message =
    `Startup failed: missing required secret(s): ${missing.join(", ")}.\n` +
    `Configure them via environment variables or your secret manager.\n` +
    `Required: ${REQUIRED_SECRET_KEYS.join(", ")}`;

  throw new SecretValidationError(message, missing);
};
