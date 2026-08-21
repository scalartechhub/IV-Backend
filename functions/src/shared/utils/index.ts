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

export const stripJsonCodeFences = (text: string): string =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

export const extractFirstJsonSlice = (text: string): string | null => {
  const cleaned = stripJsonCodeFences(text);
  const startObj = cleaned.indexOf("{");
  const startArr = cleaned.indexOf("[");

  let start = -1;
  if (startObj === -1 && startArr === -1) return null;
  if (startObj === -1) start = startArr;
  else if (startArr === -1) start = startObj;
  else start = Math.min(startObj, startArr);

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{" || ch === "[") {
      depth += 1;
      continue;
    }

    if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) {
        return cleaned.slice(start, i + 1);
      }
    }
  }

  return null;
};

export const parseModelJson = <T>(text: string): T => {
  const raw = (text ?? "").trim();
  if (!raw) {
    throw new AppError(502, "AI returned an empty response. Please try again.");
  }

  const attempts: string[] = [raw, stripJsonCodeFences(raw)];
  const sliced = extractFirstJsonSlice(raw);
  if (sliced && !attempts.includes(sliced)) {
    attempts.push(sliced);
  }

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try next candidate
    }
  }

  console.error(
    `[AI Response] Gemini returned text that is not valid JSON.\n` +
      `  Raw response preview: ${stripJsonCodeFences(raw).slice(0, 400)}${raw.length > 400 ? "..." : ""}`
  );

  throw new AppError(
    502,
    "AI returned a response we could not read. Please try again."
  );
};

export const safeJsonParse = <T>(text: string): T => parseModelJson<T>(text);
