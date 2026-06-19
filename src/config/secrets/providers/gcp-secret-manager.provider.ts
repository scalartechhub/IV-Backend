import type { AppSecrets } from "../secret.types";
import type { SecretProvider } from "./secret-provider.interface";

/**
 * Future: Google Cloud Secret Manager integration.
 *
 * Example wiring:
 *   new GcpSecretManagerProvider({ projectId: "my-project" })
 *
 * Map secret names:
 *   GEMINI_API_KEY, FIREBASE_API_KEY, FIREBASE_PROJECT_ID,
 *   FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, JWT_SECRET, SMTP_PASSWORD
 */
export class GcpSecretManagerProvider implements SecretProvider {
  constructor(private readonly _projectId: string) {
    void this._projectId;
  }

  load(): AppSecrets {
    throw new Error(
      "GcpSecretManagerProvider is not implemented yet. Use EnvSecretProvider or set " +
        "SECRET_PROVIDER=env"
    );
  }
}
