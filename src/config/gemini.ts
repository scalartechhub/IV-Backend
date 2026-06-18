import { GoogleGenAI } from "@google/genai";

/** Primary model; fallbacks used when API returns 503/429 (high demand). */
export const GEMINI_MODEL = "gemini-2.5-flash";

export const GEMINI_FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
] as const;

let _genai: GoogleGenAI | null = null;

export const getGenAI = (): GoogleGenAI => {
  if (!_genai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
    _genai = new GoogleGenAI({ apiKey });
  }
  return _genai;
};
