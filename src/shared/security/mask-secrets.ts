import type { AppSecrets } from "../../config/secrets/secret.types";

const registeredValues: string[] = [];

const SENSITIVE_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /AIza[0-9A-Za-z_-]{10,}/g,
  /-----BEGIN [A-Z ]+ KEY-----[\s\S]*?-----END [A-Z ]+ KEY-----/g,
  /("(?:api[_-]?key|password|secret|token|private[_-]?key)"\s*:\s*")([^"]+)(")/gi,
];

export const registerSecretsForMasking = (secrets: AppSecrets): void => {
  registeredValues.length = 0;

  const candidates = [
    secrets.geminiApiKey,
    secrets.firebaseApiKey,
    secrets.firebase.privateKey,
    secrets.firebase.clientEmail,
    secrets.jwtSecret,
    secrets.smtpPassword,
  ];

  for (const value of candidates) {
    if (value && value.length >= 4) {
      registeredValues.push(value);
    }
  }
};

export const maskSensitiveText = (text: string): string => {
  let masked = text;

  for (const secret of registeredValues) {
    if (secret.length >= 4) {
      masked = masked.split(secret).join("[REDACTED]");
    }
  }

  for (const pattern of SENSITIVE_PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      if (match.startsWith('"')) return match.replace(/:\s*"[^"]+"/, ': "[REDACTED]"');
      if (/Bearer/i.test(match)) return "Bearer [REDACTED]";
      if (/BEGIN/.test(match)) return "[REDACTED_PRIVATE_KEY]";
      return "[REDACTED]";
    });
  }

  return masked;
};

export const maskSensitiveValue = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return maskSensitiveText(value);
  }

  if (typeof value === "object") {
    try {
      return JSON.parse(maskSensitiveText(JSON.stringify(value)));
    } catch {
      return "[REDACTED_OBJECT]";
    }
  }

  return value;
};
