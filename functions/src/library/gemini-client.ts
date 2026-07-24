/**
 * Thin Gemini text-model client for Cloud Functions scoring / resume / roadmap.
 * Does not handle Gemini Live sessions (client-side).
 */

import { GoogleGenAI } from '@google/genai';

const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/**
 * Generate structured JSON from a system + user prompt pair.
 */
export async function generateJson<T>(params: {
  systemInstruction: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<T> {
  const result = await getClient().models.generateContent({
    model: params.model ?? DEFAULT_MODEL,
    contents: params.userPrompt,
    config: {
      systemInstruction: params.systemInstruction,
      temperature: params.temperature ?? 0.2,
      maxOutputTokens: params.maxOutputTokens ?? 4096,
      responseMimeType: 'application/json',
    },
  });

  const raw = (result.text ?? '').trim();
  if (!raw) {
    throw new Error('Empty Gemini response');
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(cleaned) as T;
  }
}

/**
 * Build Gemini Live client-side session config (instructions only — no live handling).
 */
export interface GeminiSessionConfig {
  modelVersion: string;
  systemInstructions: string;
  temperature: number;
}

export function buildGeminiSessionConfig(
  systemInstructions: string,
): GeminiSessionConfig {
  return {
    modelVersion: process.env.GEMINI_LIVE_MODEL ?? 'gemini-live-2.5',
    systemInstructions,
    temperature: 0.7,
  };
}
