import { db } from "./firebase";

export interface AppConfig {
  port: number;
  nodeEnv: "development" | "production" | "test";
  isProduction: boolean;
  isDevelopment: boolean;
  firebaseStorageBucket?: string;
  firebaseApiKey?: string;
  geminiApiKey?: string;
  groqApiKey?: string;
  sendgridApiKey?: string;
  sendgridFromEmail?: string;
  sendgridToEmail?: string;
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  razorpayWebhookSecret?: string;
  geminiModel: string;
  geminiLiveModel: string;
  geminiVoiceName: string;
  groqModel: string;
  geminiTimeoutMs: number;
  corsOrigin?: string;
}

const DEFAULT_APP_CONFIG: AppConfig = {
  port: 5000,
  nodeEnv: "development",
  isProduction: false,
  isDevelopment: true,
  firebaseStorageBucket: undefined,
  firebaseApiKey: undefined,
  geminiApiKey: undefined,
  groqApiKey: undefined,
  sendgridApiKey: undefined,
  sendgridFromEmail: undefined,
  sendgridToEmail: undefined,
  razorpayKeyId: undefined,
  razorpayKeySecret: undefined,
  razorpayWebhookSecret: undefined,
  geminiModel: "gemini-2.5-flash",
  geminiLiveModel: "gemini-2.5-flash-native-audio-preview-12-2025",
  geminiVoiceName: "Charon",
  groqModel: "llama-3.3-70b-versatile",
  geminiTimeoutMs: 60000,
  corsOrigin: undefined,
};

export const appConfig: AppConfig = { ...DEFAULT_APP_CONFIG };

const getString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const getNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

export const loadAppConfigFromFirestore = async (): Promise<void> => {
  const [appSnap, firebaseSnap, aiSnap] = await Promise.all([
    db.collection("config").doc("app").get(),
    db.collection("config").doc("firebase").get(),
    db.collection("config").doc("ai").get(),
  ]);

  const appData = appSnap.exists ? appSnap.data() ?? {} : {};
  const firebaseData = firebaseSnap.exists ? firebaseSnap.data() ?? {} : {};
  const aiData = aiSnap.exists ? aiSnap.data() ?? {} : {};
  const emailSnap = await db.collection("config").doc("email").get();
  const emailData = emailSnap.exists ? emailSnap.data() ?? {} : {};
  const paymentSnap = await db.collection("config").doc("payment").get();
  const paymentData = paymentSnap.exists ? paymentSnap.data() ?? {} : {};

  const port = getNumber(appData.port);
  const nodeEnv = getString(appData.nodeEnv) as AppConfig["nodeEnv"] | undefined;
  const corsOrigin = getString(appData.corsOrigin);
  const firebaseStorageBucket = getString(appData.firebaseStorageBucket);
  const firebaseApiKey = getString(firebaseData.firebaseApiKey);
  const geminiApiKey = getString(aiData.geminiApiKey);
  const groqApiKey = getString(aiData.groqApiKey);
  const sendgridApiKey = getString(emailData.sendgridApiKey);
  const sendgridFromEmail = getString(emailData.sendgridFromEmail);
  const sendgridToEmail = getString(emailData.sendgridToEmail);
  const razorpayKeyId = getString(paymentData.razorpayKeyId);
  const razorpayKeySecret = getString(paymentData.razorpayKeySecret);
  const razorpayWebhookSecret = getString(paymentData.razorpayWebhookSecret);

  const geminiModel = getString(aiData.geminiModel);
  const geminiLiveModel = getString(aiData.geminiLiveModel);
  const geminiVoiceName = getString(aiData.geminiVoiceName);
  const groqModel = getString(aiData.groqModel);
  const geminiTimeoutMs = getNumber(aiData.geminiTimeoutMs);

  Object.assign(appConfig, {
    port: port ?? DEFAULT_APP_CONFIG.port,
    nodeEnv: nodeEnv ?? DEFAULT_APP_CONFIG.nodeEnv,
    isProduction: (nodeEnv ?? DEFAULT_APP_CONFIG.nodeEnv) === "production",
    isDevelopment: (nodeEnv ?? DEFAULT_APP_CONFIG.nodeEnv) === "development",
    corsOrigin: corsOrigin ?? DEFAULT_APP_CONFIG.corsOrigin,
    firebaseStorageBucket:
      firebaseStorageBucket ??
      getString(firebaseData.firebaseStorageBucket) ??
      DEFAULT_APP_CONFIG.firebaseStorageBucket,
    firebaseApiKey: firebaseApiKey ?? DEFAULT_APP_CONFIG.firebaseApiKey,
    geminiApiKey: geminiApiKey ?? DEFAULT_APP_CONFIG.geminiApiKey,
    groqApiKey: groqApiKey ?? DEFAULT_APP_CONFIG.groqApiKey,
    sendgridApiKey: sendgridApiKey ?? DEFAULT_APP_CONFIG.sendgridApiKey,
    sendgridFromEmail: sendgridFromEmail ?? DEFAULT_APP_CONFIG.sendgridFromEmail,
    sendgridToEmail: sendgridToEmail ?? DEFAULT_APP_CONFIG.sendgridToEmail,
    razorpayKeyId: razorpayKeyId ?? DEFAULT_APP_CONFIG.razorpayKeyId,
    razorpayKeySecret: razorpayKeySecret ?? DEFAULT_APP_CONFIG.razorpayKeySecret,
    razorpayWebhookSecret: razorpayWebhookSecret ?? DEFAULT_APP_CONFIG.razorpayWebhookSecret,
    geminiModel: geminiModel ?? DEFAULT_APP_CONFIG.geminiModel,
    geminiLiveModel: geminiLiveModel ?? DEFAULT_APP_CONFIG.geminiLiveModel,
    geminiVoiceName: geminiVoiceName ?? DEFAULT_APP_CONFIG.geminiVoiceName,
    groqModel: groqModel ?? DEFAULT_APP_CONFIG.groqModel,
    geminiTimeoutMs: geminiTimeoutMs ?? DEFAULT_APP_CONFIG.geminiTimeoutMs,
  });
};

export type { AppConfig as AppConfigType };
