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
    console.error(
      `[Gemini] ❌ Failed to parse JSON response from Gemini.\n` +
      `  HOW TO FIX:\n` +
      `  1. The model returned text that is not valid JSON. This usually means the prompt\n` +
      `     did not clearly ask for JSON output.\n` +
      `  2. Make sure your prompt explicitly says: "Respond ONLY with valid JSON. No extra text."\n` +
      `  3. Check if the model is set to use responseMimeType: "application/json".\n` +
      `  Raw response received:\n  ${cleanText.slice(0, 500)}${cleanText.length > 500 ? "... (truncated)" : ""}`
    );
    throw new Error("AI returned an invalid response format. Please try again.");
  }
}
