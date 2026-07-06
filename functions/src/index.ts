import type { Application } from "express";
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";

const geminiApiKey = defineSecret("GEMINI_API_KEY");
const firebaseApiKey = defineSecret("FIREBASE_API_KEY");
const razorpayKeyId = defineSecret("RAZORPAY_KEY_ID");
const razorpayKeySecret = defineSecret("RAZORPAY_KEY_SECRET");
const razorpayWebhookSecret = defineSecret("RAZORPAY_WEBHOOK_SECRET");

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

let expressApp: Application | null = null;

function applyRuntimeEnv(): void {
  process.env.NODE_ENV = "production";
  process.env.GEMINI_API_KEY = geminiApiKey.value();
  process.env.FIREBASE_API_KEY = firebaseApiKey.value();
  process.env.RAZORPAY_KEY_ID = razorpayKeyId.value();
  process.env.RAZORPAY_KEY_SECRET = razorpayKeySecret.value();
  process.env.RAZORPAY_WEBHOOK_SECRET = razorpayWebhookSecret.value();
  process.env.GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  process.env.GEMINI_TIMEOUT_MS = process.env.GEMINI_TIMEOUT_MS ?? "120000";
  process.env.FIREBASE_STORAGE_BUCKET =
    process.env.STORAGE_BUCKET ??
    process.env.FIREBASE_STORAGE_BUCKET ??
    "interview-89e09.firebasestorage.app";
}

function getApp(): Application {
  if (expressApp) return expressApp;

  applyRuntimeEnv();

  const { secretService } = require("../dist/config/secrets");
  const { initializeFirebase } = require("../dist/config/firebase");
  const { initializeGemini } = require("../dist/config/gemini");

  secretService.initialize();
  initializeFirebase();
  initializeGemini();

  expressApp = require("../dist/app").default as Application;
  return expressApp;
}

export const api = onRequest(
  {
    secrets: [
      geminiApiKey,
      firebaseApiKey,
      razorpayKeyId,
      razorpayKeySecret,
      razorpayWebhookSecret,
    ],
    memory: "1GiB",
    timeoutSeconds: 300,
    cors: false,
  },
  (req, res) => getApp()(req, res)
);
