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

const trimPrompt = (prompt: string): string =>
  prompt.length > MAX_PROMPT_CHARS ? prompt.slice(0, MAX_PROMPT_CHARS) : prompt;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isBillingQuotaError = (error: unknown): boolean =>
  BILLING_QUOTA_PATTERN.test(errorMessage(error));

const isRetryableAppError = (error: AppError): boolean => error.statusCode === 504;

const isRetryableError = (error: unknown): boolean => {
  if (error instanceof AppError) return isRetryableAppError(error);
  if (isBillingQuotaError(error)) return false;
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
          if (!text) throw new AppError(500, "Gemini returned empty JSON response");

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

    if (lastError instanceof AppError && lastError.statusCode === 504) {
      throw lastError;
    }

    const message =
      appConfig.isDevelopment && lastError instanceof Error
        ? `AI service failed: ${lastError.message}`
        : "AI service temporarily unavailable. Please try again.";

    throw new AppError(502, message);
  }
}

export const aiService = new AIService();
