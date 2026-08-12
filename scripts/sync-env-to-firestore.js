/**
 * Syncs environment variables from local .env to Firebase Firestore collection 'config'.
 * Saves configurations into Firestore documents:
 *  - config/genai
 *  - config/sendgrid
 *  - config/razorpay
 *  - config/groq
 *  - config/judge0
 *  - config/firebase
 *
 * Usage: node scripts/sync-env-to-firestore.js
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

// 1. Load .env file
const envPath = path.resolve(__dirname, "..", ".env");
let envValues = { ...process.env };

if (fs.existsSync(envPath)) {
  console.log(`[SyncScript] Reading environment variables from ${envPath}...`);
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && value) {
      envValues[key] = value;
    }
  }
} else {
  console.log("[SyncScript] .env file not found, using process.env...");
}

// 2. Initialize Firebase Admin SDK
function initFirebase() {
  const saCandidates = [
    path.resolve(__dirname, "..", "firebase-service-account.json"),
    path.resolve(__dirname, "..", "..", "firebase-service-account.json"),
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
  ];

  let saPath = saCandidates.find((p) => p && fs.existsSync(p));

  if (saPath) {
    console.log(`[SyncScript] Using service account: ${saPath}`);
    const serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf8"));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    console.log("[SyncScript] Using default application credentials...");
    admin.initializeApp();
  }

  return admin.firestore();
}

async function syncToFirestore() {
  const db = initFirebase();
  console.log("\n[SyncScript] Syncing configuration documents to Firestore collection 'config'...\n");

  const configs = {
    genai: {
      apiKey: envValues.GEMINI_API_KEY || "",
      model: envValues.GEMINI_MODEL || "gemini-2.5-flash",
      liveModel: envValues.GEMINI_LIVE_MODEL || "gemini-2.5-flash-native-audio-preview-12-2025",
      voiceName: envValues.GEMINI_VOICE_NAME || "Charon",
      timeoutMs: Number(envValues.GEMINI_TIMEOUT_MS || 60000),
      resumeModel: envValues.RESUME_GEMINI_MODEL || "",
    },
    sendgrid: {
      apiKey: envValues.SENDGRID_API_KEY || "",
      fromEmail: envValues.SENDGRID_FROM_EMAIL || "info@scalartechhub.com",
      ownerEmail: envValues.OWNER_EMAIL || "ashishgupta95652@gmail.com",
    },
    razorpay: {
      keyId: envValues.RAZORPAY_KEY_ID || "",
      keySecret: envValues.RAZORPAY_KEY_SECRET || "",
      webhookSecret: envValues.RAZORPAY_WEBHOOK_SECRET || "",
    },
    groq: {
      apiKey: envValues.GROQ_API_KEY || "",
      model: envValues.GROQ_MODEL || "llama-3.3-70b-versatile",
    },
    judge0: {
      url: envValues.JUDGE0_URL || "http://localhost:2358",
    },
    firebase: {
      apiKey: envValues.FIREBASE_API_KEY || "",
      storageBucket: envValues.FIREBASE_STORAGE_BUCKET || "",
    },
  };

  for (const [docId, data] of Object.entries(configs)) {
    // Remove empty string fields to keep docs clean, unless specified
    const cleanedData = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== "" && v !== undefined && v !== null) {
        cleanedData[k] = v;
      }
    }

    if (Object.keys(cleanedData).length > 0) {
      console.log(`  Writing config/${docId}:`, cleanedData);
      await db.collection("config").doc(docId).set(cleanedData, { merge: true });
    } else {
      console.log(`  Skipping config/${docId} (no non-empty values)`);
    }
  }

  console.log("\n✅ All environment credentials synced successfully to Firebase Firestore!\n");
  process.exit(0);
}

syncToFirestore().catch((err) => {
  console.error("❌ Failed to sync config to Firestore:", err);
  process.exit(1);
});
