const isDev = process.env.NODE_ENV !== "production";

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

const format = (level: LogLevel, message: string, meta?: unknown): string => {
  const ts = new Date().toISOString();
  const metaPart = meta !== undefined ? ` ${JSON.stringify(meta)}` : "";
  return `[${ts}] [${level}] ${message}${metaPart}`;
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
    if (isDev) console.log(format("DEBUG", message, meta));
  },
};
