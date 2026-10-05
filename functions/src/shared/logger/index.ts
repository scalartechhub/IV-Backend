import { appConfig } from "../../config/app.config";
import { maskSensitiveText, maskSensitiveValue } from "../security/mask-secrets";

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

const format = (level: LogLevel, message: string, meta?: unknown): string => {
  const ts = new Date().toISOString();
  const safeMessage = maskSensitiveText(message);

  if (meta === undefined) {
    return `[${ts}] [${level}] ${safeMessage}`;
  }

  if (meta instanceof Error) {
    const metaObj = maskSensitiveValue(meta) as Record<string, unknown>;
    const code = metaObj.status || metaObj.statusCode || metaObj.code;
    const codeStr = code ? ` [Code: ${code}]` : "";
    const stackStr = meta.stack ? `\n${maskSensitiveText(meta.stack)}` : "";
    return `[${ts}] [${level}] ${safeMessage}: ${metaObj.name || "Error"}${codeStr} - ${metaObj.message}${stackStr}`;
  }

  let metaPart = "";
  try {
    const masked = maskSensitiveValue(meta);
    metaPart = ` ${JSON.stringify(masked)}`;
  } catch {
    metaPart = " [Unserializable Object]";
  }
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
