import { GoogleGenAI } from "@google/genai";
import { appConfig } from "./app.config";
import { secretService } from "./secrets";

const SECONDARY_FALLBACK_MODEL = "gemini-2.0-flash";

export const GEMINI_MODEL = appConfig.geminiModel;

export const GEMINI_FALLBACK_MODELS: readonly string[] =
  GEMINI_MODEL === SECONDARY_FALLBACK_MODEL
    ? [GEMINI_MODEL]
    : [GEMINI_MODEL, SECONDARY_FALLBACK_MODEL];

export const GEMINI_REQUEST_TIMEOUT_MS = appConfig.geminiTimeoutMs;

let _genai: GoogleGenAI | null = null;

export const initializeGemini = (): void => {
  if (_genai) return;
  _genai = new GoogleGenAI({ apiKey: secretService.getGeminiApiKey() });
};

export const getGenAI = (): GoogleGenAI => {
  if (!_genai) {
    initializeGemini();
  }
  return _genai!;
};
