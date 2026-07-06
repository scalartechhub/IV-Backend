import { registerSecretsForMasking } from "../../shared/security/mask-secrets";
import type { AppSecrets, FirebaseCredentials } from "./secret.types";
import { validateSecrets, SecretValidationError } from "./secret.validation";
import { EnvSecretProvider, type SecretProvider } from "./providers";

export class SecretService {
  private secrets: Readonly<AppSecrets> | null = null;
  private initialized = false;

  /**
   * Load, validate, and cache all secrets once at startup.
   * Must be called before Firebase/Gemini initialization and before handling requests.
   */
  initialize(provider?: SecretProvider): void {
    if (this.initialized) return;

    const secretProvider = provider ?? new EnvSecretProvider();
    const loaded = secretProvider.load();

    validateSecrets(loaded);

    this.secrets = Object.freeze(loaded);
    registerSecretsForMasking(this.secrets);
    this.initialized = true;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  private requireSecrets(): Readonly<AppSecrets> {
    if (!this.secrets) {
      throw new SecretValidationError(
        "SecretService has not been initialized. Call secretService.initialize() at startup.",
        []
      );
    }
    return this.secrets;
  }

  getGeminiApiKey(): string {
    return this.requireSecrets().geminiApiKey;
  }

  getFirebaseApiKey(): string {
    return this.requireSecrets().firebaseApiKey;
  }

  getFirebaseCredentials(): FirebaseCredentials {
    return this.requireSecrets().firebase;
  }

  getJwtSecret(): string | undefined {
    return this.requireSecrets().jwtSecret;
  }

  requireJwtSecret(): string {
    const secret = this.getJwtSecret();
    if (!secret) {
      throw new SecretValidationError("JWT_SECRET is not configured", ["JWT_SECRET"]);
    }
    return secret;
  }

  getSmtpPassword(): string | undefined {
    return this.requireSecrets().smtpPassword;
  }

  requireSmtpPassword(): string {
    const secret = this.getSmtpPassword();
    if (!secret) {
      throw new SecretValidationError("SMTP_PASSWORD is not configured", ["SMTP_PASSWORD"]);
    }
    return secret;
  }
}

export const secretService = new SecretService();
