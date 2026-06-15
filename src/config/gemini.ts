import { GoogleGenAI } from "@google/genai";

export const GEMINI_MODEL = "gemini-2.5-flash";

let _genai: GoogleGenAI | null = null;

export const getGenAI = (): GoogleGenAI => {
  if (!_genai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
    _genai = new GoogleGenAI({ apiKey });
  }
  return _genai;
};
