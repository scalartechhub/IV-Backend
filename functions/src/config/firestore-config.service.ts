import { db } from "./firebase";
import { logger } from "../shared/logger";

export interface GenAIConfig {
  apiKey?: string;
  model?: string;
  liveModel?: string;
  voiceName?: string;
  timeoutMs?: number;
  resumeModel?: string;
}

export interface SendGridConfig {
  apiKey?: string;
  fromEmail?: string;
  ownerEmail?: string;
}

export interface RazorpayConfig {
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
}

export interface GroqConfig {
  apiKey?: string;
  model?: string;
}

export interface Judge0Config {
  url?: string;
}

export interface FirebaseClientConfig {
  apiKey?: string;
  storageBucket?: string;
}

export interface FirestoreConfigMap {
  genai: GenAIConfig;
  sendgrid: SendGridConfig;
  razorpay: RazorpayConfig;
  groq: GroqConfig;
  judge0: Judge0Config;
  firebase: FirebaseClientConfig;
}

class FirestoreConfigService {
  private configCache: Partial<FirestoreConfigMap> = {};
  private loaded = false;

  /**
   * Fetches all configuration documents from the 'config' collection in Firestore.
   * If a document or key is missing, falls back to process.env.
   * Caches results in memory for subsequent synchronous or fast access.
   */
  async loadConfigFromFirestore(): Promise<FirestoreConfigMap> {
    if (this.loaded) {
      return this.configCache as FirestoreConfigMap;
    }

    try {
      if (!db) {
        logger.warn("[FirestoreConfigService] Firestore db not initialized yet. Using process.env fallbacks.");
        this.populateFromEnv();
        this.loaded = true;
        return this.configCache as FirestoreConfigMap;
      }

      const snapshot = await db.collection("config").get();
      const docsData: Record<string, any> = {};

      snapshot.forEach((doc) => {
        docsData[doc.id] = doc.data();
      });

      // Parse GenAI Config
      const genaiDoc = docsData["genai"] || {};
      const genaiConfig: GenAIConfig = {
        apiKey: genaiDoc.apiKey || genaiDoc.GEMINI_API_KEY || process.env.GEMINI_API_KEY,
        model: genaiDoc.model || genaiDoc.GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash",
        liveModel: genaiDoc.liveModel || genaiDoc.GEMINI_LIVE_MODEL || process.env.GEMINI_LIVE_MODEL || "gemini-2.5-flash-native-audio-preview-12-2025",
        voiceName: genaiDoc.voiceName || genaiDoc.GEMINI_VOICE_NAME || process.env.GEMINI_VOICE_NAME || "Charon",
        timeoutMs: genaiDoc.timeoutMs ? Number(genaiDoc.timeoutMs) : (process.env.GEMINI_TIMEOUT_MS ? Number(process.env.GEMINI_TIMEOUT_MS) : 60000),
        resumeModel: genaiDoc.resumeModel || genaiDoc.RESUME_GEMINI_MODEL || process.env.RESUME_GEMINI_MODEL,
      };

      // Parse SendGrid Config
      const sendgridDoc = docsData["sendgrid"] || {};
      const sendgridConfig: SendGridConfig = {
        apiKey: sendgridDoc.apiKey || sendgridDoc.SENDGRID_API_KEY || process.env.SENDGRID_API_KEY,
        fromEmail: sendgridDoc.fromEmail || sendgridDoc.SENDGRID_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL,
        ownerEmail: sendgridDoc.ownerEmail || process.env.OWNER_EMAIL || "ashishgupta95652@gmail.com",
      };

      // Parse Razorpay Config
      const razorpayDoc = docsData["razorpay"] || {};
      const razorpayConfig: RazorpayConfig = {
        keyId: razorpayDoc.keyId || razorpayDoc.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID,
        keySecret: razorpayDoc.keySecret || razorpayDoc.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET,
        webhookSecret: razorpayDoc.webhookSecret || razorpayDoc.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET,
      };

      // Parse Groq Config
      const groqDoc = docsData["groq"] || {};
      const groqConfig: GroqConfig = {
        apiKey: groqDoc.apiKey || groqDoc.GROQ_API_KEY || process.env.GROQ_API_KEY,
        model: groqDoc.model || groqDoc.GROQ_MODEL || process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      };

      // Parse Judge0 Config
      const judge0Doc = docsData["judge0"] || {};
      const judge0Config: Judge0Config = {
        url: judge0Doc.url || judge0Doc.JUDGE0_URL || process.env.JUDGE0_URL || "http://localhost:2358",
      };

      // Parse Firebase Client Config
      const firebaseDoc = docsData["firebase"] || {};
      const firebaseConfig: FirebaseClientConfig = {
        apiKey: firebaseDoc.apiKey || firebaseDoc.FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
        storageBucket: firebaseDoc.storageBucket || firebaseDoc.FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
      };

      this.configCache = {
        genai: genaiConfig,
        sendgrid: sendgridConfig,
        razorpay: razorpayConfig,
        groq: groqConfig,
        judge0: judge0Config,
        firebase: firebaseConfig,
      };

      // Sync to process.env for third-party libraries reading directly from environment
      this.syncToProcessEnv();

      this.loaded = true;
      logger.info("[FirestoreConfigService] Successfully loaded configuration documents from Firestore.");
    } catch (err: any) {
      logger.error("[FirestoreConfigService] Failed to load config from Firestore, falling back to process.env", {
        error: err.message,
      });
      this.populateFromEnv();
      this.loaded = true;
    }

    return this.configCache as FirestoreConfigMap;
  }

  private populateFromEnv(): void {
    this.configCache = {
      genai: {
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        liveModel: process.env.GEMINI_LIVE_MODEL || "gemini-2.5-flash-native-audio-preview-12-2025",
        voiceName: process.env.GEMINI_VOICE_NAME || "Charon",
        timeoutMs: process.env.GEMINI_TIMEOUT_MS ? Number(process.env.GEMINI_TIMEOUT_MS) : 60000,
        resumeModel: process.env.RESUME_GEMINI_MODEL,
      },
      sendgrid: {
        apiKey: process.env.SENDGRID_API_KEY,
        fromEmail: process.env.SENDGRID_FROM_EMAIL,
        ownerEmail: process.env.OWNER_EMAIL || "ashishgupta95652@gmail.com",
      },
      razorpay: {
        keyId: process.env.RAZORPAY_KEY_ID,
        keySecret: process.env.RAZORPAY_KEY_SECRET,
        webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
      },
      groq: {
        apiKey: process.env.GROQ_API_KEY,
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      },
      judge0: {
        url: process.env.JUDGE0_URL || "http://localhost:2358",
      },
      firebase: {
        apiKey: process.env.FIREBASE_API_KEY,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      },
    };
  }

  private syncToProcessEnv(): void {
    const { genai, sendgrid, razorpay, groq, judge0, firebase } = this.configCache;

    if (genai?.apiKey) process.env.GEMINI_API_KEY = genai.apiKey;
    if (genai?.model) process.env.GEMINI_MODEL = genai.model;
    if (genai?.liveModel) process.env.GEMINI_LIVE_MODEL = genai.liveModel;
    if (genai?.voiceName) process.env.GEMINI_VOICE_NAME = genai.voiceName;
    if (genai?.timeoutMs) process.env.GEMINI_TIMEOUT_MS = String(genai.timeoutMs);
    if (genai?.resumeModel) process.env.RESUME_GEMINI_MODEL = genai.resumeModel;

    if (sendgrid?.apiKey) process.env.SENDGRID_API_KEY = sendgrid.apiKey;
    if (sendgrid?.fromEmail) process.env.SENDGRID_FROM_EMAIL = sendgrid.fromEmail;

    if (razorpay?.keyId) process.env.RAZORPAY_KEY_ID = razorpay.keyId;
    if (razorpay?.keySecret) process.env.RAZORPAY_KEY_SECRET = razorpay.keySecret;
    if (razorpay?.webhookSecret) process.env.RAZORPAY_WEBHOOK_SECRET = razorpay.webhookSecret;

    if (groq?.apiKey) process.env.GROQ_API_KEY = groq.apiKey;
    if (groq?.model) process.env.GROQ_MODEL = groq.model;

    if (judge0?.url) process.env.JUDGE0_URL = judge0.url;

    if (firebase?.apiKey) process.env.FIREBASE_API_KEY = firebase.apiKey;
    if (firebase?.storageBucket) process.env.FIREBASE_STORAGE_BUCKET = firebase.storageBucket;
  }

  getGenAIConfig(): GenAIConfig {
    if (!this.loaded) this.populateFromEnv();
    return this.configCache.genai || {};
  }

  getSendGridConfig(): SendGridConfig {
    if (!this.loaded) this.populateFromEnv();
    return this.configCache.sendgrid || {};
  }

  getRazorpayConfig(): RazorpayConfig {
    if (!this.loaded) this.populateFromEnv();
    return this.configCache.razorpay || {};
  }

  getGroqConfig(): GroqConfig {
    if (!this.loaded) this.populateFromEnv();
    return this.configCache.groq || {};
  }

  getJudge0Config(): Judge0Config {
    if (!this.loaded) this.populateFromEnv();
    return this.configCache.judge0 || {};
  }

  getFirebaseConfig(): FirebaseClientConfig {
    if (!this.loaded) this.populateFromEnv();
    return this.configCache.firebase || {};
  }
}

export const firestoreConfigService = new FirestoreConfigService();
