import fs from "fs";
import path from "path";
import { config as loadEnv } from "dotenv";

const appEnv = (process.env.APP_ENV || "").trim().toLowerCase();

const candidates: string[] = [];

if (appEnv === "dev" || appEnv === "development") {
  candidates.push(
    path.resolve(__dirname, "../../.env.dev"),
    path.resolve(__dirname, "../../.env.development"),
    path.resolve(__dirname, "../.env.dev"),
    path.resolve(__dirname, "../.env.interview-89e09")
  );
} else if (appEnv === "prod" || appEnv === "production") {
  candidates.push(
    path.resolve(__dirname, "../../.env.production"),
    path.resolve(__dirname, "../.env.production"),
    path.resolve(__dirname, "../.env.interview-prod-dd24f")
  );
}

// Default fallbacks
candidates.push(
  path.resolve(__dirname, "../../.env"),
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../.env.dev"),
  path.resolve(__dirname, "../.env.interview-89e09")
);

const matchedPath = candidates.find((p) => fs.existsSync(p));

if (matchedPath) {
  loadEnv({ path: matchedPath });
  console.log(`[EnvLoader] Loaded environment variables from: ${matchedPath}`);
} else {
  loadEnv();
  console.log("[EnvLoader] Using system process.env");
}
