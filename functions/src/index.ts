import type { Application } from "express";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import app from "./app";
import { bootstrapApplication } from "./bootstrap";

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

let expressApp: Application | null = null;
let bootstrapPromise: Promise<void> | null = null;

async function getApp(): Promise<Application> {
  if (expressApp) return expressApp;

  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapApplication();
  }
  await bootstrapPromise;
  expressApp = app;
  return expressApp;
}

export const api = onRequest(
  {
    memory: "1GiB",
    timeoutSeconds: 300,
    cors: false,
  },
  async (req, res) => (await getApp())(req, res)
);
