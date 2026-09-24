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
    ""
  ).trim();
  if (!model) {
    throw new AppError(
      503,
      'Gemini AI model is not configured. Please set the "model" field in Firestore collection "config", document "genai" (e.g. "gemini-3.6-flash").'
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

export const GEMINI_REQUEST_TIMEOUT_MS = 120000;
export const getGeminiRequestTimeoutMs = (): number => appConfig.geminiTimeoutMs;

let _genai: GoogleGenAI | null = null;
let _currentApiKey: string | null = null;

export const initializeGemini = (): void => {
  const apiKey = (firestoreConfigService.getGenAIConfig().apiKey || secretService.getGeminiApiKey() || "").trim();
  if (!apiKey) {
    _genai = null;
    _currentApiKey = null;
    throw new AppError(
      503,
      'Gemini AI API key is not configured. Please set the "apiKey" field in Firestore collection "config", document "genai".'
    );
  }
  if (_genai && _currentApiKey === apiKey) {
    return;
  }
  _currentApiKey = apiKey;
  _genai = new GoogleGenAI({ apiKey });
};

export const getGenAI = (): GoogleGenAI => {
  initializeGemini();
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
        if (error instanceof AppError) throw error;
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
    const rawMsg = lastError?.message || "Unknown error";
    if (rawMsg.includes("API key not valid") || rawMsg.includes("API_KEY_INVALID")) {
      throw new AppError(
        502,
        'Invalid Gemini API key. Please check the "apiKey" field in Firestore collection "config", document "genai".'
      );
    }
    if (rawMsg.includes("RESOURCE_EXHAUSTED") || rawMsg.includes("quota")) {
      throw new AppError(
        429,
        'Gemini API quota exceeded for configured model. Please check API quota or configure "fallbackModels" in Firestore collection "config", document "genai".'
      );
    }
    throw new AppError(
      502,
      `AI analysis failed: ${rawMsg}`,
    );
  },
};

export function parseGeminiJSON(text: string): any {
  return parseModelJson(text);
}
