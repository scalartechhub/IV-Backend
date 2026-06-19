import { appConfig } from "../../config/app.config";
import { maskSensitiveText, maskSensitiveValue } from "../security/mask-secrets";

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

const format = (level: LogLevel, message: string, meta?: unknown): string => {
  const ts = new Date().toISOString();
  const safeMessage = maskSensitiveText(message);
  const metaPart =
    meta !== undefined ? ` ${JSON.stringify(maskSensitiveValue(meta))}` : "";
  return `[${ts}] [${level}] ${safeMessage}${metaPart}`;
};

export const logger = {
  info: (message: string, meta?: unknown): void => {
    console.log(format("INFO", message, meta));
  },
  warn: (message: string, meta?: unknown): void => {
    console.warn(format("WARN", message, meta));
  },
  error: (message: string, meta?: unknown): void => {
    console.error(format("ERROR", message, meta));
  },
  debug: (message: string, meta?: unknown): void => {
    if (appConfig.isDevelopment) {
      console.log(format("DEBUG", message, meta));
    }
  },
};
