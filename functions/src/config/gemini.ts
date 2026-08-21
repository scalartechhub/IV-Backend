import { GoogleGenAI } from "@google/genai";
import { appConfig } from "./app.config";
import { secretService } from "./secrets";
import { logger } from "../shared/logger";
import { AppError, parseModelJson } from "../shared/utils";

import { firestoreConfigService } from "./firestore-config.service";

const SECONDARY_FALLBACK_MODEL = "gemini-1.5-flash";

export function getActiveGeminiModel(): string {
  const model = (
    firestoreConfigService.getGenAIConfig().model ||
    appConfig.geminiModel ||
    process.env.GEMINI_MODEL ||
    ""
  ).trim();
  if (!model) {
    throw new AppError(
      503,
      'Gemini AI model is not configured. Please set the "model" field in Firestore collection "config", document "genai" (e.g. "gemini-2.0-flash").'
    );
  }
  return model;
}

export function getGeminiFallbackModels(): readonly string[] {
  const configured = firestoreConfigService.getGenAIConfig().fallbackModels;
  if (Array.isArray(configured) && configured.length > 0) {
    return configured;
  }
  const primary = getActiveGeminiModel();
  return [primary];
}

export const GEMINI_REQUEST_TIMEOUT_MS = appConfig.geminiTimeoutMs;

let _genai: GoogleGenAI | null = null;

export const initializeGemini = (): void => {
  if (_genai) return;
  const apiKey = firestoreConfigService.getGenAIConfig().apiKey || secretService.getGeminiApiKey();
  _genai = new GoogleGenAI({ apiKey });
};

export const getGenAI = (): GoogleGenAI => {
  if (!_genai) {
    initializeGemini();
  }
  return _genai!;
};

export const geminiModel = {
  async generateContent(
    prompt: string,
  ): Promise<{ response: { text: () => string } }> {
    const model = getActiveGeminiModel();
    const result = await getGenAI().models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 1024,
      },
    });

    const text = result.text ?? "";
    return { response: { text: () => text } };
  },

  async generateJSON<T = any>(
    prompt: string,
    options: {
      temperature?: number;
      maxOutputTokens?: number;
      useFallbackModels?: boolean;
    } = {},
  ): Promise<T> {
    const {
      temperature = 0.2,
      maxOutputTokens = 2048,
      useFallbackModels = true,
    } = options;

    const primaryModel = getActiveGeminiModel();
    const fallbackList = getGeminiFallbackModels();
    const modelsToTry = useFallbackModels
      ? [primaryModel, ...fallbackList.filter((m: string) => m !== primaryModel)]
      : [primaryModel];
    let lastError: Error | null = null;

    for (const model of modelsToTry) {
      try {
        const result = await getGenAI().models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature,
            topP: 0.95,
            topK: 40,
            maxOutputTokens,
            responseMimeType: "application/json", 
          },
        });

        const rawText = result.text ?? "";

        if (!rawText || rawText.trim().length === 0) {
          throw new Error("Empty response from Gemini");
        }

        return parseModelJson<T>(rawText);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(
          `[geminiService] Model ${model} failed, trying next fallback`,
          {
            error: lastError.message,
          },
        );
      }
    }

    logger.error("[geminiService] All models failed to generate JSON");
    throw new AppError(
      502,
      `AI analysis failed: ${lastError?.message || "Unknown error"}`,
    );
  },
};

export function parseGeminiJSON(text: string): any {
  return parseModelJson(text);
}
