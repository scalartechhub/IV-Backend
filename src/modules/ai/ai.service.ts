import { getGenAI, GEMINI_FALLBACK_MODELS } from "../../config/gemini";
import { logger } from "../../shared/logger";
import { AppError, safeJsonParse } from "../../shared/utils";

const MAX_PROMPT_CHARS = 24_000;
const MAX_ATTEMPTS_PER_MODEL = 3;
const BASE_RETRY_MS = 2000;

const RETRYABLE_PATTERN =
  /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|temporarily unavailable/i;

const BILLING_QUOTA_PATTERN =
  /prepayment credits|billing|quota exceeded|insufficient quota|payment required/i;

const trimPrompt = (prompt: string): string =>
  prompt.length > MAX_PROMPT_CHARS ? prompt.slice(0, MAX_PROMPT_CHARS) : prompt;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isBillingQuotaError = (error: unknown): boolean =>
  BILLING_QUOTA_PATTERN.test(errorMessage(error));

const isRetryableError = (error: unknown): boolean => {
  if (isBillingQuotaError(error)) return false;
  return RETRYABLE_PATTERN.test(errorMessage(error));
};

const isHighDemandError = (error: unknown): boolean => {
  const message = errorMessage(error);
  return /503|UNAVAILABLE|high demand/i.test(message);
};

export class AIService {
  async generateJSON<T>(prompt: string, maxOutputTokens = 4096): Promise<T> {
    const trimmedPrompt = trimPrompt(prompt);
    let lastError: unknown;

    for (const model of GEMINI_FALLBACK_MODELS) {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
        try {
          const genai = getGenAI();
          const response = await genai.models.generateContent({
            model,
            contents: trimmedPrompt,
            config: {
              responseMimeType: "application/json",
              temperature: 0.3,
              maxOutputTokens,
            },
          });

          const text = response.text?.trim();
          if (!text) throw new AppError(500, "Gemini returned empty JSON response");

          if (model !== GEMINI_FALLBACK_MODELS[0]) {
            logger.info(`[AIService] succeeded with fallback model ${model}`);
          }

          return safeJsonParse<T>(text);
        } catch (error) {
          lastError = error;
          if (error instanceof AppError) throw error;

          if (isBillingQuotaError(error)) {
            throw new AppError(
              402,
              "Gemini API credits are depleted. Add billing or top up credits in Google AI Studio: https://ai.studio/projects"
            );
          }

          const retryable = isRetryableError(error);
          logger.warn(
            `[AIService] ${model} attempt ${attempt}/${MAX_ATTEMPTS_PER_MODEL} failed`,
            error instanceof Error ? error.message : error
          );

          if (!retryable) break;

          if (attempt < MAX_ATTEMPTS_PER_MODEL) {
            await sleep(BASE_RETRY_MS * attempt);
          }
        }
      }
    }

    if (isHighDemandError(lastError)) {
      throw new AppError(
        503,
        "AI service is busy due to high demand. Please wait a moment and try again."
      );
    }

    const message =
      process.env.NODE_ENV === "development" && lastError instanceof Error
        ? `AI service failed: ${lastError.message}`
        : "AI service temporarily unavailable. Please try again.";

    throw new AppError(502, message);
  }
}

export const aiService = new AIService();
