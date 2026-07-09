import type { Application } from "express";
import { defineSecret } from "firebase-functions/params";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import app from "./app";
import { bootstrapApplication } from "./bootstrap";

const geminiApiKey = defineSecret("GEMINI_API_KEY");
const firebaseApiKey = defineSecret("FIREBASE_API_KEY");
const groqApiKey = defineSecret("GROQ_API_KEY");
const razorpayKeyId = defineSecret("RAZORPAY_KEY_ID");
const razorpayKeySecret = defineSecret("RAZORPAY_KEY_SECRET");
const razorpayWebhookSecret = defineSecret("RAZORPAY_WEBHOOK_SECRET");
const sendgridApiKey = defineSecret('SENDGRID_API_KEY');

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

let expressApp: Application | null = null;

function applyRuntimeEnv(): void {
  process.env.NODE_ENV = "production";
  process.env.GEMINI_API_KEY = geminiApiKey.value();
  process.env.FIREBASE_API_KEY = firebaseApiKey.value();
  process.env.GROQ_API_KEY = groqApiKey.value();
  process.env.RAZORPAY_KEY_ID = razorpayKeyId.value();
  process.env.RAZORPAY_KEY_SECRET = razorpayKeySecret.value();
  process.env.RAZORPAY_WEBHOOK_SECRET = razorpayWebhookSecret.value();
  process.env.GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  process.env.GEMINI_TIMEOUT_MS = process.env.GEMINI_TIMEOUT_MS ?? "120000";
  process.env.FIREBASE_STORAGE_BUCKET =
    process.env.STORAGE_BUCKET ??
    process.env.FIREBASE_STORAGE_BUCKET ??
    "interview-89e09.firebasestorage.app";
  
  process.env.SENDGRID_API_KEY = sendgridApiKey.value(); 
  process.env.SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || "info@scalartechhub.com";
  process.env.SENDGRID_TO_EMAIL = process.env.SENDGRID_TO_EMAIL || "info@scalartechhub.com";
}

function getApp(): Application {
  if (expressApp) return expressApp;

  applyRuntimeEnv();
  bootstrapApplication();
  expressApp = app;
  return expressApp;
}

export const api = onRequest(
  {
    secrets: [
      geminiApiKey,
      firebaseApiKey,
      groqApiKey,
      razorpayKeyId,
      razorpayKeySecret,
      razorpayWebhookSecret,
      sendgridApiKey
    ],
    memory: "1GiB",
    timeoutSeconds: 300,
    cors: false,
  },
  (req, res) => getApp()(req, res)
);
