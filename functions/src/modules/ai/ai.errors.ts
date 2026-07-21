import { AppError } from "../../shared/utils";

export type AiResponseContext =
  | "evaluation"
  | "batch-evaluation"
  | "report"
  | "resume"
  | "jd"
  | "json";

const CONTEXT_LABELS: Record<AiResponseContext, string> = {
  evaluation: "answer evaluation",
  "batch-evaluation": "batch answer evaluation",
  report: "interview report",
  resume: "resume analysis",
  jd: "job description analysis",
  json: "AI JSON response",
};

const DEFAULT_FIX_STEPS = [
  "Retry the request — AI responses can occasionally be incomplete.",
  "Check that your Gemini API key is valid and has available quota.",
  "If the problem continues, check server logs for the raw AI response.",
];

interface AiResponseErrorDetails {
  missingField?: string;
  expected?: string;
  received?: unknown;
  fixSteps?: string[];
}

const formatReceived = (value: unknown): string => {
  if (value === undefined) return "missing (not sent by AI)";
  if (value === null) return "null";
  if (typeof value === "string") {
    return value.trim() === "" ? 'empty string ""' : `"${value.slice(0, 120)}"`;
  }
  try {
    const text = JSON.stringify(value);
    return text.length > 200 ? `${text.slice(0, 200)}...` : text;
  } catch {
    return String(value);
  }
};

export const throwAiResponseError = (
  context: AiResponseContext,
  userMessage: string,
  details: AiResponseErrorDetails = {}
): never => {
  const label = CONTEXT_LABELS[context];
  const fixSteps = details.fixSteps ?? DEFAULT_FIX_STEPS;

  console.error(
    `[AI Response] Invalid ${label} from Gemini.\n` +
      `  WHAT THIS MEANS: ${userMessage}\n` +
      (details.missingField ? `  Problem field: "${details.missingField}"\n` : "") +
      (details.expected ? `  Expected: ${details.expected}\n` : "") +
      (details.received !== undefined ? `  Got instead: ${formatReceived(details.received)}\n` : "") +
      `  HOW TO FIX:\n` +
      fixSteps.map((step, index) => `  ${index + 1}. ${step}`).join("\n")
  );

  throw new AppError(502, userMessage);
};
