/**
 * Syncs GEMINI_API_KEY and FIREBASE_API_KEY from .env to Firebase Secret Manager.
 * Usage: node scripts/sync-firebase-secrets.js
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const envPath = path.resolve(__dirname, "..", ".env");
if (!fs.existsSync(envPath)) {
  console.error(".env file not found. Create it with GEMINI_API_KEY and FIREBASE_API_KEY.");
  process.exit(1);
}

const env = fs.readFileSync(envPath, "utf8");
const values = {};

for (const line of env.split(/\r?\n/)) {
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
  values[key] = value;
}

const secretKeys = ["GEMINI_API_KEY", "FIREBASE_API_KEY"];

for (const key of secretKeys) {
  const value = values[key]?.trim();
  if (!value) {
    console.error(`Missing ${key} in .env`);
    process.exit(1);
  }

  console.log(`Setting Firebase secret: ${key}`);
  execSync(`firebase functions:secrets:set ${key}`, {
    input: value,
    stdio: ["pipe", "inherit", "inherit"],
  });
}

console.log("Firebase secrets synced.");
