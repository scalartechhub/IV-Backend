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

export const geminiModel = {
  async generateContent(prompt: string): Promise<{ response: { text: () => string } }> {
    const result = await getGenAI().models.generateContent({
      model: GEMINI_MODEL,
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
};

export function parseGeminiJSON(text: string): any {
  const cleanText = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleanText);
  } catch {
    console.error("Failed to parse Gemini JSON:", cleanText);
    throw new Error("Invalid JSON response from AI");
  }
}
