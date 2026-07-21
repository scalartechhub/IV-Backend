export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly errors?: import("../errors").ApiFieldError[]
  ) {
    super(message);
    this.name = "AppError";
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
};

export const safeJsonParse = <T>(text: string): T => {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    console.error(
      `[AI Response] Gemini returned text that is not valid JSON.\n` +
        `  WHAT THIS MEANS: The AI reply could not be read as JSON.\n` +
        `  HOW TO FIX:\n` +
        `  1. Retry the request — this is usually a temporary AI formatting issue.\n` +
        `  2. Check Gemini API key and quota in your .env file.\n` +
        `  3. If it keeps failing, inspect the raw response in server logs.\n` +
        `  Raw response preview: ${cleaned.slice(0, 300)}${cleaned.length > 300 ? "..." : ""}`
    );
    throw new AppError(
      502,
      "AI returned a response we could not read. Please try again."
    );
  }
};
