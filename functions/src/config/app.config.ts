import { firestoreConfigService } from "./firestore-config.service";

/**
 * Non-secret application configuration.
 * Dynamically resolves from Firestore `config` documents with sensible fallbacks.
 * Secrets must be accessed exclusively via secretService.
 */
export const appConfig = {
  get port(): number {
    // Cloud Run / containers inject PORT — prefer it over Firestore/local defaults.
    const fromEnv = Number(process.env.PORT);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
    return firestoreConfigService.getAppConfigDoc().port || 5000;
  },
  get nodeEnv(): "development" | "production" | "test" {
    const raw =
      firestoreConfigService.getAppConfigDoc().nodeEnv ||
      (process.env.APP_ENV === "production" ? "production" : "development");
    return raw === "production" || raw === "test" ? raw : "development";
  },
  get isProduction(): boolean {
    return this.nodeEnv === "production";
  },
  get isDevelopment(): boolean {
    return this.nodeEnv === "development";
  },
  get firebaseStorageBucket(): string | undefined {
    return firestoreConfigService.getFirebaseConfig().storageBucket;
  },
  get geminiModel(): string | undefined {
    return firestoreConfigService.getGenAIConfig().model;
  },
  get geminiLiveModel(): string | undefined {
    return firestoreConfigService.getGenAIConfig().liveModel;
  },
  get geminiVoiceName(): string {
    return firestoreConfigService.getGenAIConfig().voiceName || "Charon";
  },
  get groqModel(): string {
    return firestoreConfigService.getGroqConfig().model || "llama-3.3-70b-versatile";
  },
  get geminiTimeoutMs(): number {
    return firestoreConfigService.getGenAIConfig().timeoutMs || 120000;
  },
  get corsOrigin(): string | undefined {
    return firestoreConfigService.getAppConfigDoc().corsOrigin;
  },
  get judge0Url(): string {
    const configured =
      firestoreConfigService.getJudge0Config().url || process.env.JUDGE0_URL || "";
    if (configured.trim()) {
      return configured.trim();
    }
    // Dev-only loopback default — never fall back to a public Judge0 IP.
    if (this.isDevelopment) {
      return "http://127.0.0.1:2358/";
    }
    return "";
  },
  get judge0AuthToken(): string | undefined {
    const token =
      firestoreConfigService.getJudge0Config().authToken ||
      process.env.JUDGE0_AUTH_TOKEN ||
      "";
    return token.trim() || undefined;
  },
  get teamsWebhookUrl(): string | undefined {
    return firestoreConfigService.getDiscordConfig().webhookUrl;
  },
  get teamsAlertInDev(): boolean {
    return false;
  },
  get osmOverpassUrl(): string | undefined {
    return firestoreConfigService.getOSMConfig().overpassUrl || "https://overpass.openstreetmap.fr/api/interpreter";
  },
  get osmOverpassFallbackUrl(): string | undefined {
    return firestoreConfigService.getOSMConfig().overpassFallbackUrl || "https://overpass-api.de/api/interpreter";
  },
  get frontendUrl(): string | undefined {
    return firestoreConfigService.getAppConfigDoc().frontendUrl;
  },
};

export type AppConfig = typeof appConfig;
