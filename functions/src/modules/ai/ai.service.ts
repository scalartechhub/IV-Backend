import { getGenAI, GEMINI_FALLBACK_MODELS, GEMINI_REQUEST_TIMEOUT_MS } from "../../config/gemini";
import { appConfig } from "../../config/app.config";
import { logger } from "../../shared/logger";
import { AppError, safeJsonParse } from "../../shared/utils";

const MAX_PROMPT_CHARS = 24_000;
const MAX_ATTEMPTS_PER_MODEL = 3;
const BASE_RETRY_MS = 2000;

const RETRYABLE_PATTERN =
  /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|temporarily unavailable/i;

const BILLING_QUOTA_PATTERN =
  /prepayment credits|billing|quota exceeded|insufficient quota|payment required/i;

const RATE_LIMIT_PATTERN = /429|RESOURCE_EXHAUSTED|rate.?limit|too many requests/i;

const INVALID_API_KEY_PATTERN = /api.?key|invalid.*key|API_KEY_INVALID|permission denied/i;

const trimPrompt = (prompt: string): string =>
  prompt.length > MAX_PROMPT_CHARS ? prompt.slice(0, MAX_PROMPT_CHARS) : prompt;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isBillingQuotaError = (error: unknown): boolean =>
  BILLING_QUOTA_PATTERN.test(errorMessage(error));

const isRateLimitError = (error: unknown): boolean =>
  RATE_LIMIT_PATTERN.test(errorMessage(error));

const isInvalidApiKeyError = (error: unknown): boolean =>
  INVALID_API_KEY_PATTERN.test(errorMessage(error));

const isRetryableAppError = (error: AppError): boolean => error.statusCode === 504;

const isRetryableError = (error: unknown): boolean => {
  if (error instanceof AppError) return isRetryableAppError(error);
  if (isBillingQuotaError(error)) return false;
  if (isInvalidApiKeyError(error)) return false;
  return RETRYABLE_PATTERN.test(errorMessage(error));
};

const isHighDemandError = (error: unknown): boolean => {
  const message = errorMessage(error);
  return /503|UNAVAILABLE|high demand/i.test(message);
};

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AppError(504, "AI request timed out. Please try again.")),
      ms
    );
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
};

export class AIService {
  async generateJSON<T>(prompt: string, maxOutputTokens = 4096): Promise<T> {
    const trimmedPrompt = trimPrompt(prompt);
    let lastError: unknown;
    const primaryModel = GEMINI_FALLBACK_MODELS[0];

    for (const model of GEMINI_FALLBACK_MODELS) {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
        const startedAt = Date.now();

        try {
          const genai = getGenAI();
          const response = await withTimeout(
            genai.models.generateContent({
              model,
              contents: trimmedPrompt,
              config: {
                responseMimeType: "application/json",
                temperature: 0.3,
                maxOutputTokens,
              },
            }),
            GEMINI_REQUEST_TIMEOUT_MS
          );

          const text = response.text?.trim();
          if (!text) {
            console.warn(
              `[Gemini] Model "${model}" returned an empty response.\n` +
              `  HOW TO FIX: The model may have blocked the prompt or hit output limits.\n` +
              `  Try: (1) Check if your prompt contains restricted content. (2) Reduce maxOutputTokens. (3) Inspect prompt for unusual characters.`
            );
            throw new AppError(502, "AI returned an empty response. Please try again.");
          }

          const elapsedMs = Date.now() - startedAt;
          if (model !== primaryModel) {
            logger.info(`[AIService] succeeded with fallback model ${model}`, { elapsedMs });
          } else {
            logger.debug(`[AIService] ${model} completed`, { elapsedMs });
          }

          return safeJsonParse<T>(text);
        } catch (error) {
          lastError = error;

          if (error instanceof AppError && !isRetryableAppError(error)) {
            throw error;
          }

          if (isInvalidApiKeyError(error)) {
            console.error(
              `[Gemini] ❌ Invalid or missing API key.\n` +
              `  HOW TO FIX:\n` +
              `  1. Open your .env file and check that GEMINI_API_KEY is set correctly.\n` +
              `  2. Get a valid key from: https://aistudio.google.com/app/apikey\n` +
              `  3. Restart the server after updating the key.\n` +
              `  Raw error: ${errorMessage(error)}`
            );
            throw new AppError(
              401,
              "Gemini API key is invalid or missing. Please contact support."
            );
          }

          if (isBillingQuotaError(error)) {
            console.error(
              `[Gemini] ❌ Billing quota exceeded or credits depleted.\n` +
              `  HOW TO FIX:\n` +
              `  1. Go to Google AI Studio: https://aistudio.google.com/app/apikey\n` +
              `  2. Check your billing/credits under your project.\n` +
              `  3. Enable billing or top up prepaid credits.\n` +
              `  4. If on free tier, you may need to upgrade your plan.\n` +
              `  Raw error: ${errorMessage(error)}`
            );
            throw new AppError(
              402,
              "AI service quota has been reached. Please try again later or contact support."
            );
          }

          if (isRateLimitError(error)) {
            console.warn(
              `[Gemini] ⚠️ Rate limit hit on model "${model}" (attempt ${attempt}/${MAX_ATTEMPTS_PER_MODEL}).\n` +
              `  HOW TO FIX:\n` +
              `  1. You are sending too many requests per minute — slow down request frequency.\n` +
              `  2. Upgrade your Google AI Studio plan for higher rate limits.\n` +
              `  3. The server will automatically retry after a short wait.\n` +
              `  Raw error: ${errorMessage(error)}`
            );
          }

          const retryable = isRetryableError(error);

          logger.warn(
            `[AIService] ${model} attempt ${attempt}/${MAX_ATTEMPTS_PER_MODEL} failed`,
            error instanceof Error ? error.message : error
          );

          if (!retryable) {
            console.error(
              `[Gemini] ❌ Non-retryable error on model "${model}".\n` +
              `  Error: ${errorMessage(error)}`
            );
            break;
          }

          if (attempt < MAX_ATTEMPTS_PER_MODEL) {
            const waitMs = BASE_RETRY_MS * attempt;
            console.warn(
              `[Gemini] ⚠️ Retrying model "${model}" in ${waitMs / 1000}s (attempt ${attempt + 1}/${MAX_ATTEMPTS_PER_MODEL})...`
            );
            await sleep(waitMs);
          }
        }
      }
    }

    if (isHighDemandError(lastError)) {
      console.error(
        `[Gemini] ❌ All models failed due to high demand / service unavailable.\n` +
        `  HOW TO FIX:\n` +
        `  1. This is a temporary Gemini outage. Wait 1-2 minutes and try again.\n` +
        `  2. Check the Gemini status page: https://status.cloud.google.com\n` +
        `  3. Consider adding more fallback models in config/gemini.ts if outages are frequent.`
      );
      throw new AppError(
        503,
        "AI service is temporarily busy. Please wait a moment and try again."
      );
    }

    if (lastError instanceof AppError && lastError.statusCode === 504) {
      console.error(
        `[Gemini] ❌ Request timed out after ${GEMINI_REQUEST_TIMEOUT_MS / 1000}s.\n` +
        `  HOW TO FIX:\n` +
        `  1. Increase GEMINI_TIMEOUT_MS in your .env or app config.\n` +
        `  2. Reduce the prompt size (current limit: ${MAX_PROMPT_CHARS} chars).\n` +
        `  3. Reduce maxOutputTokens if it is set very high.`
      );
      throw lastError;
    }

    console.error(
      `[Gemini] ❌ All retry attempts exhausted across all models.\n` +
      `  HOW TO FIX:\n` +
      `  1. Check your GEMINI_API_KEY is valid and has available quota.\n` +
      `  2. Check Gemini status: https://status.cloud.google.com\n` +
      `  3. Verify your network can reach Google APIs.\n` +
      `  Last error: ${errorMessage(lastError)}`
    );

    const message =
      appConfig.isDevelopment && lastError instanceof Error
        ? `AI service failed: ${lastError.message}`
        : "AI service is temporarily unavailable. Please try again in a few moments.";

    throw new AppError(502, message);
  }
}

export const aiService = new AIService();
