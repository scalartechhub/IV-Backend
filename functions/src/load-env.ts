import fs from "fs";
import path from "path";
import { config as loadEnv } from "dotenv";

const rootEnvPath = path.resolve(__dirname, "../../.env");
const functionsEnvPath = path.resolve(__dirname, "../.env");

if (fs.existsSync(rootEnvPath)) {
  loadEnv({ path: rootEnvPath });
} else if (fs.existsSync(functionsEnvPath)) {
  loadEnv({ path: functionsEnvPath });
} else {
  loadEnv();
}
