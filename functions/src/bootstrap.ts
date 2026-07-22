import { secretService, SecretValidationError } from "./config/secrets";
import { initializeFirebase } from "./config/firebase";
import { initializeGemini } from "./config/gemini";
import { appConfig, loadAppConfigFromFirestore } from "./config/app.config";

/** Shared startup for local server and Firebase Functions runtime. */
export const bootstrapApplication = async (): Promise<void> => {
  initializeFirebase();
  await loadAppConfigFromFirestore();

  process.env.NODE_ENV = appConfig.nodeEnv;
  process.env.GEMINI_API_KEY = appConfig.geminiApiKey ?? process.env.GEMINI_API_KEY ?? "";
  process.env.FIREBASE_API_KEY = appConfig.firebaseApiKey ?? process.env.FIREBASE_API_KEY ?? "";
  process.env.GROQ_API_KEY = appConfig.groqApiKey ?? process.env.GROQ_API_KEY ?? "";
  process.env.RAZORPAY_KEY_ID = appConfig.razorpayKeyId ?? process.env.RAZORPAY_KEY_ID ?? "";
  process.env.RAZORPAY_KEY_SECRET = appConfig.razorpayKeySecret ?? process.env.RAZORPAY_KEY_SECRET ?? "";
  process.env.RAZORPAY_WEBHOOK_SECRET = appConfig.razorpayWebhookSecret ?? process.env.RAZORPAY_WEBHOOK_SECRET ?? "";

  secretService.initialize();
  initializeGemini();
};

export { SecretValidationError };
