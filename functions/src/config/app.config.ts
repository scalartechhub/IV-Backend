import { z } from "zod";

/**
 * Non-secret application configuration only.
 * Secrets must be accessed exclusively via secretService.
 */
const appConfigSchema = z.object({
  PORT: z.string().default("5000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_LIVE_MODEL: z
    .string()
    .default("gemini-2.5-flash-native-audio-preview-12-2025"),
  GEMINI_VOICE_NAME: z.string().default("Charon"),
  GEMINI_TIMEOUT_MS: z
    .string()
    .default("60000")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(5000).max(300_000)),
  CORS_ORIGIN: z.string().optional(),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"), 
});

const parsed = appConfigSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid application configuration:");
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

const data = parsed.data;

export const appConfig = {
  port: parseInt(data.PORT, 10),
  nodeEnv: data.NODE_ENV,
  isProduction: data.NODE_ENV === "production",
  isDevelopment: data.NODE_ENV === "development",
  firebaseStorageBucket: data.FIREBASE_STORAGE_BUCKET,
  geminiModel: data.GEMINI_MODEL,
  geminiLiveModel: data.GEMINI_LIVE_MODEL,
  geminiVoiceName: data.GEMINI_VOICE_NAME,
  groqModel: data.GROQ_MODEL,
  geminiTimeoutMs: data.GEMINI_TIMEOUT_MS,
  corsOrigin: data.CORS_ORIGIN,
} as const;

export type AppConfig = typeof appConfig;
