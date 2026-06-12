import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().default("5000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  FIREBASE_API_KEY: z.string().min(1, "FIREBASE_API_KEY is required"),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
