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
  proMonthlyPlanId?: string;
  proYearlyPlanId?: string;
  eliteMonthlyPlanId?: string;
  eliteYearlyPlanId?: string;
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
  projectId?: string;
  authDomain?: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
}

export interface DiscordConfig {
  webhookUrl?: string;
}

export interface AppConfigDoc {
  port?: number;
  nodeEnv?: string;
  corsOrigin?: string;
  frontendUrl?: string;
}

export interface OSMConfig {
  overpassUrl?: string;
  overpassFallbackUrl?: string;
  timeoutMs?: number;
}

export interface FirestoreConfigMap {
  genai: GenAIConfig;
  smtp: SMTPConfig;
  razorpay: RazorpayConfig;
  groq: GroqConfig;
  judge0: Judge0Config;
  firebase: FirebaseClientConfig;
  discord: DiscordConfig;
  app: AppConfigDoc;
  osm: OSMConfig;
}

class FirestoreConfigService {
  private configCache: Partial<FirestoreConfigMap> = {};
  private loaded = false;
  private lastFetchTime = 0;
  private readonly CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes cache TTL

  clearCache(): void {
    this.loaded = false;
    this.lastFetchTime = 0;
    this.configCache = {};
  }

  async refreshConfig(): Promise<FirestoreConfigMap> {
    this.clearCache();
    return this.loadConfigFromFirestore(true);
  }

  /**
   * Ensures the configuration is loaded and not older than CACHE_TTL_MS.
   * If expired or not yet loaded, automatically refreshes from Firestore.
   */
  async ensureFreshConfig(): Promise<FirestoreConfigMap> {
    const isExpired = Date.now() - this.lastFetchTime > this.CACHE_TTL_MS;
    if (!this.loaded || isExpired) {
      return this.loadConfigFromFirestore(true);
    }
    return this.configCache as FirestoreConfigMap;
  }

  /**
   * Fetches all configuration documents from the 'config' collection in Firestore.
   * Caches results in memory with a 3-minute TTL so changes in Firestore are picked up automatically.
   */
  async loadConfigFromFirestore(forceRefresh = false): Promise<FirestoreConfigMap> {
    const isExpired = Date.now() - this.lastFetchTime > this.CACHE_TTL_MS;
    if (this.loaded && !forceRefresh && !isExpired) {
      return this.configCache as FirestoreConfigMap;
    }

    if (forceRefresh) {
      this.clearCache();
    }

    try {
      if (!db) {
        throw new Error("[FirestoreConfigService] Firestore database is not initialized. Cannot load config collection.");
      }

      const snapshot = await db.collection("config").get();
      const docsData: Record<string, any> = {};

      snapshot.forEach((doc) => {
        docsData[doc.id] = doc.data();
      });

      // Parse GenAI Config
      const genaiDoc = docsData["genai"] || {};
      const aiDoc = docsData["ai"] || {};
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
        apiKey: genaiDoc.apiKey || genaiDoc.GEMINI_API_KEY || aiDoc.geminiApiKey || "",
        model: genaiDoc.model || genaiDoc.GEMINI_MODEL || "gemini-3.6-flash",
        liveModel: genaiDoc.liveModel || genaiDoc.GEMINI_LIVE_MODEL || "gemini-2.5-flash-native-audio-preview-12-2025",
        fallbackModels: parseFallbackModels(genaiDoc.fallbackModels || genaiDoc.GEMINI_FALLBACK_MODELS),
        voiceName: genaiDoc.voiceName || genaiDoc.GEMINI_VOICE_NAME || "Charon",
        timeoutMs: genaiDoc.timeoutMs ? Number(genaiDoc.timeoutMs) : 120000,
        resumeModel: genaiDoc.resumeModel || genaiDoc.RESUME_GEMINI_MODEL || "gemini-3.6-flash",
      };

      // Parse Razorpay Config (exclusively from 'config/razorpay')
      const razorpayDoc = docsData["razorpay"] || {};
      const razorpayConfig: RazorpayConfig = {
        keyId: razorpayDoc.keyId || razorpayDoc.RAZORPAY_KEY_ID || "",
        keySecret: razorpayDoc.keySecret || razorpayDoc.RAZORPAY_KEY_SECRET || "",
        webhookSecret: razorpayDoc.webhookSecret || razorpayDoc.RAZORPAY_WEBHOOK_SECRET || "",
        proMonthlyPlanId: razorpayDoc.proMonthlyPlanId || razorpayDoc.RAZORPAY_PRO_MONTHLY_PLAN_ID,
        proYearlyPlanId: razorpayDoc.proYearlyPlanId || razorpayDoc.RAZORPAY_PRO_YEARLY_PLAN_ID,
        eliteMonthlyPlanId: razorpayDoc.eliteMonthlyPlanId || razorpayDoc.RAZORPAY_ELITE_MONTHLY_PLAN_ID,
        eliteYearlyPlanId: razorpayDoc.eliteYearlyPlanId || razorpayDoc.RAZORPAY_ELITE_YEARLY_PLAN_ID,
      };

      // Parse Groq Config
      const groqDoc = docsData["groq"] || {};
      const groqConfig: GroqConfig = {
        apiKey: groqDoc.apiKey || groqDoc.GROQ_API_KEY || aiDoc.groqApiKey || "",
        model: groqDoc.model || groqDoc.GROQ_MODEL || "llama-3.3-70b-versatile",
      };

      // Parse Judge0 Config
      const judge0Doc = docsData["judge0"] || {};
      const judge0Config: Judge0Config = {
        url: judge0Doc.url || judge0Doc.JUDGE0_URL || "http://34.180.31.202:2358/",
      };

      // Parse Firebase Client Config
      const firebaseDoc = docsData["firebase"] || {};
      const firebaseConfig: FirebaseClientConfig = {
        apiKey: firebaseDoc.apiKey || firebaseDoc.FIREBASE_API_KEY || firebaseDoc.FB_API_KEY || firebaseDoc.firebaseApiKey || "",
        storageBucket: firebaseDoc.storageBucket || firebaseDoc.FIREBASE_STORAGE_BUCKET || firebaseDoc.firebaseStorageBucket || "",
        projectId: firebaseDoc.projectId || firebaseDoc.FIREBASE_PROJECT_ID || firebaseDoc.FB_PROJECT_ID || "",
        authDomain: firebaseDoc.authDomain || firebaseDoc.FIREBASE_AUTH_DOMAIN || "",
        messagingSenderId: firebaseDoc.messagingSenderId || firebaseDoc.FIREBASE_MESSAGING_SENDER_ID || "",
        appId: firebaseDoc.appId || firebaseDoc.FIREBASE_APP_ID || "",
        measurementId: firebaseDoc.measurementId || firebaseDoc.FIREBASE_MEASUREMENT_ID || "",
      };

      // Parse Discord Config (reads from 'discord' or 'alerts' document in 'config' collection)
      const discordDoc = docsData["discord"] || docsData["alerts"] || {};
      const discordConfig: DiscordConfig = {
        webhookUrl: discordDoc.webhookUrl || discordDoc.DISCORD_WEBHOOK_URL || discordDoc.webhook_url || discordDoc.url || "",
      };

      // Parse SMTP Config
      const smtpDoc = docsData["smtp"] || {};
      const smtpConfig: SMTPConfig = {
        host: smtpDoc.host || smtpDoc.SMTP_HOST || "smtp.gmail.com",
        port: smtpDoc.port ? Number(smtpDoc.port) : 465,
        secure: smtpDoc.secure !== undefined ? Boolean(smtpDoc.secure) : true,
        user: smtpDoc.user || smtpDoc.SMTP_USER || "",
        pass: smtpDoc.pass || smtpDoc.SMTP_PASS || "",
        from: smtpDoc.from || smtpDoc.SMTP_FROM || "",
      };

      // Parse App Config
      const appDoc = docsData["app"] || {};
      const appConfigDoc: AppConfigDoc = {
        port: appDoc.port ? Number(appDoc.port) : 5000,
        nodeEnv: appDoc.nodeEnv || (process.env.APP_ENV === "production" ? "production" : "development"),
        corsOrigin: appDoc.corsOrigin || "",
        frontendUrl: appDoc.frontendUrl || appDoc.IV_FRONTEND_URL || "",
      };

      // Parse OSM Config
      const osmDoc = docsData["osm"] || {};
      const osmConfig: OSMConfig = {
        overpassUrl: osmDoc.overpassUrl || osmDoc.OSM_OVERPASS_URL || "https://overpass-api.de/api/interpreter",
        overpassFallbackUrl: osmDoc.overpassFallbackUrl || osmDoc.OSM_OVERPASS_FALLBACK_URL || "https://overpass.kumi.systems/api/interpreter",
        timeoutMs: osmDoc.timeoutMs ? Number(osmDoc.timeoutMs) : 25000,
      };

      this.configCache = {
        genai: genaiConfig,
        smtp: smtpConfig,
        razorpay: razorpayConfig,
        groq: groqConfig,
        judge0: judge0Config,
        firebase: firebaseConfig,
        discord: discordConfig,
        app: appConfigDoc,
        osm: osmConfig,
      };

      // Sync to process.env for third-party libraries reading directly from environment in Node runtime
      this.syncToProcessEnv();

      this.loaded = true;
      this.lastFetchTime = Date.now();
      logger.info("[FirestoreConfigService] Successfully loaded configuration documents from Firestore.");
    } catch (err: any) {
      logger.error("[FirestoreConfigService] Failed to load config from Firestore", {
        error: err.message,
      });
      throw err;
    }

    return this.configCache as FirestoreConfigMap;
  }

  private syncToProcessEnv(): void {
    const { genai, smtp, razorpay, groq, judge0, firebase, discord, app, osm } = this.configCache;

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
    if (razorpay?.proMonthlyPlanId) process.env.RAZORPAY_PRO_MONTHLY_PLAN_ID = razorpay.proMonthlyPlanId;
    if (razorpay?.proYearlyPlanId) process.env.RAZORPAY_PRO_YEARLY_PLAN_ID = razorpay.proYearlyPlanId;
    if (razorpay?.eliteMonthlyPlanId) process.env.RAZORPAY_ELITE_MONTHLY_PLAN_ID = razorpay.eliteMonthlyPlanId;
    if (razorpay?.eliteYearlyPlanId) process.env.RAZORPAY_ELITE_YEARLY_PLAN_ID = razorpay.eliteYearlyPlanId;

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
    if (firebase?.projectId) {
      process.env.FIREBASE_PROJECT_ID = firebase.projectId;
      process.env.FB_PROJECT_ID = firebase.projectId;
    }
    if (firebase?.authDomain) {
      process.env.FIREBASE_AUTH_DOMAIN = firebase.authDomain;
      process.env.FB_AUTH_DOMAIN = firebase.authDomain;
    }
    if (discord?.webhookUrl) {
      process.env.DISCORD_WEBHOOK_URL = discord.webhookUrl;
    }

    if (osm?.overpassUrl) process.env.OSM_OVERPASS_URL = osm.overpassUrl;
    if (osm?.overpassFallbackUrl) process.env.OSM_OVERPASS_FALLBACK_URL = osm.overpassFallbackUrl;
    if (osm?.timeoutMs) process.env.OVERPASS_TIMEOUT_MS = String(osm.timeoutMs);
  }

  getGenAIConfig(): GenAIConfig {
    return this.configCache.genai || {};
  }

  getSMTPConfig(): SMTPConfig {
    return this.configCache.smtp || {};
  }

  getRazorpayConfig(): RazorpayConfig {
    return this.configCache.razorpay || {};
  }

  getGroqConfig(): GroqConfig {
    return this.configCache.groq || {};
  }

  getJudge0Config(): Judge0Config {
    return this.configCache.judge0 || {};
  }

  getFirebaseConfig(): FirebaseClientConfig {
    return this.configCache.firebase || {};
  }

  getDiscordConfig(): DiscordConfig {
    return this.configCache.discord || {};
  }

  getAppConfigDoc(): AppConfigDoc {
    return this.configCache.app || {};
  }

  getOSMConfig(): OSMConfig {
    return this.configCache.osm || {};
  }
}

export const firestoreConfigService = new FirestoreConfigService();
