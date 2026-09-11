import { db } from "./firebase";
import { logger } from "../shared/logger";

export interface GenAIConfig {
  apiKey?: string;
  model?: string;
  liveModel?: string;
  fallbackModels?: string[];
  voiceName?: string;
  timeoutMs?: number;
  resumeModel?: string;
}

export interface SMTPConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from?: string;
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

export interface DiscordConfig {
  webhookUrl?: string;
}

export interface FirestoreConfigMap {
  genai: GenAIConfig;
  smtp: SMTPConfig;
  razorpay: RazorpayConfig;
  groq: GroqConfig;
  judge0: Judge0Config;
  firebase: FirebaseClientConfig;
  discord: DiscordConfig;
}

class FirestoreConfigService {
  private configCache: Partial<FirestoreConfigMap> = {};
  private loaded = false;

  clearCache(): void {
    this.loaded = false;
    this.configCache = {};
  }

  async refreshConfig(): Promise<FirestoreConfigMap> {
    this.clearCache();
    return this.loadConfigFromFirestore();
  }

  /**
   * Fetches all configuration documents from the 'config' collection in Firestore.
   * If a document or key is missing, falls back to process.env.
   * Caches results in memory for subsequent synchronous or fast access.
   */
  async loadConfigFromFirestore(forceRefresh = false): Promise<FirestoreConfigMap> {
    if (forceRefresh) {
      this.clearCache();
    }

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
      const parseFallbackModels = (val: any): string[] => {
        if (Array.isArray(val) && val.length > 0) {
          return val.map((s) => String(s).trim()).filter(Boolean);
        }
        if (typeof val === "string" && val.trim()) {
          return val.split(",").map((s) => s.trim()).filter(Boolean);
        }
        return [];
      };

      const genaiConfig: GenAIConfig = {
        apiKey: genaiDoc.apiKey || genaiDoc.GEMINI_API_KEY || process.env.GEMINI_API_KEY,
        model: genaiDoc.model || genaiDoc.GEMINI_MODEL || process.env.GEMINI_MODEL,
        liveModel: genaiDoc.liveModel || genaiDoc.GEMINI_LIVE_MODEL || process.env.GEMINI_LIVE_MODEL,
        fallbackModels: parseFallbackModels(genaiDoc.fallbackModels || genaiDoc.GEMINI_FALLBACK_MODELS || process.env.GEMINI_FALLBACK_MODELS),
        voiceName: genaiDoc.voiceName || genaiDoc.GEMINI_VOICE_NAME || process.env.GEMINI_VOICE_NAME || "Charon",
        timeoutMs: genaiDoc.timeoutMs ? Number(genaiDoc.timeoutMs) : (process.env.GEMINI_TIMEOUT_MS ? Number(process.env.GEMINI_TIMEOUT_MS) : 120000),
        resumeModel: genaiDoc.resumeModel || genaiDoc.RESUME_GEMINI_MODEL || process.env.RESUME_GEMINI_MODEL,
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
        apiKey: firebaseDoc.apiKey || firebaseDoc.FIREBASE_API_KEY || firebaseDoc.FB_API_KEY || process.env.FIREBASE_API_KEY || process.env.FB_API_KEY,
        storageBucket: firebaseDoc.storageBucket || firebaseDoc.FIREBASE_STORAGE_BUCKET || firebaseDoc.FB_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || process.env.FB_STORAGE_BUCKET,
      };

      // Parse Discord Config (reads from 'discord' or 'alerts' document in 'config' collection)
      const discordDoc = docsData["discord"] || docsData["alerts"] || {};
      const discordConfig: DiscordConfig = {
        webhookUrl:
          discordDoc.webhookUrl ||
          discordDoc.DISCORD_WEBHOOK_URL ||
          discordDoc.webhook_url ||
          discordDoc.url ||
          process.env.DISCORD_WEBHOOK_URL,
      };

      // Parse SMTP Config
      const smtpDoc = docsData["smtp"] || {};
      const smtpConfig: SMTPConfig = {
        host: smtpDoc.host || smtpDoc.SMTP_HOST || process.env.SMTP_HOST,
        port: smtpDoc.port ? Number(smtpDoc.port) : (process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined),
        secure: smtpDoc.secure !== undefined ? Boolean(smtpDoc.secure) : (process.env.SMTP_SECURE === 'true'),
        user: smtpDoc.user || smtpDoc.SMTP_USER || process.env.SMTP_USER,
        pass: smtpDoc.pass || smtpDoc.SMTP_PASS || process.env.SMTP_PASS,
        from: smtpDoc.from || smtpDoc.SMTP_FROM || process.env.SMTP_FROM,
      };

      this.configCache = {
        genai: genaiConfig,
        smtp: smtpConfig,
        razorpay: razorpayConfig,
        groq: groqConfig,
        judge0: judge0Config,
        firebase: firebaseConfig,
        discord: discordConfig,
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
    const rawFallback = process.env.GEMINI_FALLBACK_MODELS;
    const fallbackModels = rawFallback
      ? rawFallback.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    this.configCache = {
      genai: {
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL,
        fallbackModels,
        liveModel: process.env.GEMINI_LIVE_MODEL,
        voiceName: process.env.GEMINI_VOICE_NAME || "Charon",
        timeoutMs: process.env.GEMINI_TIMEOUT_MS ? Number(process.env.GEMINI_TIMEOUT_MS) : 120000,
        resumeModel: process.env.RESUME_GEMINI_MODEL,
      },
      smtp: {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        from: process.env.SMTP_FROM,
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
        apiKey: process.env.FIREBASE_API_KEY || process.env.FB_API_KEY,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.FB_STORAGE_BUCKET,
      },
      discord: {
        webhookUrl: process.env.DISCORD_WEBHOOK_URL,
      },
    };
  }

  private syncToProcessEnv(): void {
    const { genai, smtp, razorpay, groq, judge0, firebase, discord } = this.configCache;

    if (genai?.apiKey) process.env.GEMINI_API_KEY = genai.apiKey;
    if (genai?.model) process.env.GEMINI_MODEL = genai.model;
    if (genai?.fallbackModels?.length) process.env.GEMINI_FALLBACK_MODELS = genai.fallbackModels.join(",");
    if (genai?.liveModel) process.env.GEMINI_LIVE_MODEL = genai.liveModel;
    if (genai?.voiceName) process.env.GEMINI_VOICE_NAME = genai.voiceName;
    if (genai?.timeoutMs) process.env.GEMINI_TIMEOUT_MS = String(genai.timeoutMs);
    if (genai?.resumeModel) process.env.RESUME_GEMINI_MODEL = genai.resumeModel;

    if (smtp?.host) process.env.SMTP_HOST = smtp.host;
    if (smtp?.port) process.env.SMTP_PORT = String(smtp.port);
    if (smtp?.secure !== undefined) process.env.SMTP_SECURE = String(smtp.secure);
    if (smtp?.user) process.env.SMTP_USER = smtp.user;
    if (smtp?.pass) process.env.SMTP_PASS = smtp.pass;
    if (smtp?.from) process.env.SMTP_FROM = smtp.from;

    if (razorpay?.keyId) process.env.RAZORPAY_KEY_ID = razorpay.keyId;
    if (razorpay?.keySecret) process.env.RAZORPAY_KEY_SECRET = razorpay.keySecret;
    if (razorpay?.webhookSecret) process.env.RAZORPAY_WEBHOOK_SECRET = razorpay.webhookSecret;

    if (groq?.apiKey) process.env.GROQ_API_KEY = groq.apiKey;
    if (groq?.model) process.env.GROQ_MODEL = groq.model;

    if (judge0?.url) process.env.JUDGE0_URL = judge0.url;

    if (firebase?.apiKey) {
      process.env.FIREBASE_API_KEY = firebase.apiKey;
      process.env.FB_API_KEY = firebase.apiKey;
    }
    if (firebase?.storageBucket) {
      process.env.FIREBASE_STORAGE_BUCKET = firebase.storageBucket;
      process.env.FB_STORAGE_BUCKET = firebase.storageBucket;
    }
    if (discord?.webhookUrl) {
      process.env.DISCORD_WEBHOOK_URL = discord.webhookUrl;
    }
  }

  getGenAIConfig(): GenAIConfig {
    if (!this.loaded) this.populateFromEnv();
    return this.configCache.genai || {};
  }

  getSMTPConfig(): SMTPConfig {
    if (!this.loaded) this.populateFromEnv();
    return this.configCache.smtp || {};
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

  getDiscordConfig(): DiscordConfig {
    if (!this.loaded) this.populateFromEnv();
    return this.configCache.discord || {};
  }
}

export const firestoreConfigService = new FirestoreConfigService();
