import type { ZodError } from "zod";
import type multer from "multer";

export interface ApiFieldError {
  field: string;
  message: string;
}

export const formatZodErrors = (error: ZodError): ApiFieldError[] => {
  const flattened = error.flatten();
  const fieldErrors = Object.entries(flattened.fieldErrors).flatMap(([field, messages]) =>
    (Array.isArray(messages) ? messages : []).map((message: string) => ({ field, message }))
  );
  const formErrors = flattened.formErrors.map((message) => ({
    field: "request",
    message,
  }));

  return [...formErrors, ...fieldErrors];
};

export const buildValidationMessage = (errors: ApiFieldError[]): string => {
  if (errors.length === 0) {
    return "Invalid request. Please check the fields and try again.";
  }

  if (errors.length === 1) {
    const { field, message } = errors[0];
    return field === "request" ? message : `${field}: ${message}`;
  }

  return `Invalid request: ${errors.map(({ field, message }) => `${field}: ${message}`).join("; ")}`;
};

export const formatMulterError = (error: multer.MulterError, fieldHint?: string): string => {
  switch (error.code) {
    case "LIMIT_FILE_SIZE":
      return "File is too large. Maximum allowed size is 10 MB per file.";
    case "LIMIT_FILE_COUNT":
      return "Too many files uploaded. Please upload only the allowed file fields.";
    case "LIMIT_UNEXPECTED_FILE":
      return (
        fieldHint ??
        'Unexpected file field. Use the correct form-data keys for this endpoint (e.g. "file", "resume", or "jd").'
      );
    case "LIMIT_PART_COUNT":
      return "Upload contains too many parts. Please send only the required file fields.";
    default:
      return error.message || "File upload failed. Please check the file and try again.";
  }
};

export const mapFirebaseAuthError = (code?: string): string => {
  switch (code) {
    case "auth/id-token-expired":
      return "Your session has expired. Please log in again.";
    case "auth/argument-error":
      return "Invalid authorization token. Please log in again.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact support for help.";
    case "auth/user-not-found":
      return "User account not found. Please register or use a different account.";
    default:
      return "Authentication failed. Please log in again.";
  }
};

export const mapFirebaseLoginError = (code?: string): string => {
  switch (code) {
    case "EMAIL_NOT_FOUND":
    case "INVALID_PASSWORD":
    case "INVALID_LOGIN_CREDENTIALS":
      return "Invalid email or password.";
    case "USER_DISABLED":
      return "This account has been disabled. Contact support for help.";
    case "TOO_MANY_ATTEMPTS_TRY_LATER":
      return "Too many failed login attempts. Please wait a few minutes and try again.";
    case "INVALID_EMAIL":
      return "Please enter a valid email address.";
    case "WEAK_PASSWORD":
      return "Password is too weak. Use at least 6 characters.";
    default:
      return "Login failed. Please check your email and password.";
  }
};

export const normalizeFieldErrors = (details: unknown): ApiFieldError[] | undefined => {
  if (!details || typeof details !== "object") return undefined;

  const record = details as Record<string, unknown>;
  const errors: ApiFieldError[] = [];

  for (const [field, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      for (const message of value) {
        if (typeof message === "string") {
          errors.push({ field, message });
        }
      }
    } else if (typeof value === "string") {
      errors.push({ field, message: value });
    }
  }

  return errors.length > 0 ? errors : undefined;
};
