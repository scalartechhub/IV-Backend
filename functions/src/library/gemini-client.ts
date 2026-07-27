/**
 * Thin Gemini text-model client for Cloud Functions scoring / resume / roadmap.
 * Does not handle Gemini Live sessions (client-side).
 */

import { GoogleGenAI, Modality } from '@google/genai';

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

const DEFAULT_LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL ?? 'gemini-2.5-flash-native-audio-preview-12-2025';

/**
 * Without an explicit language, Gemini Live auto-detects language per utterance and can
 * mis-transcribe accented English as Hindi/Marathi, confusing the interviewer model. Pin both
 * transcription and speech synthesis to English so answers are recognized/replied to consistently.
 */
const INTERVIEW_LANGUAGE_CODES = ['en-US', 'en-IN'];

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
    modelVersion: DEFAULT_LIVE_MODEL,
    systemInstructions,
    temperature: 0.7,
  };
}

export interface LiveEphemeralToken {
  token: string;
  model: string;
  expireTime: string;
}

/**
 * Mint a short-lived Gemini Live auth token so the browser can connect directly
 * to Gemini's Live API (WebSocket) without ever seeing GEMINI_API_KEY.
 * Client usage: `new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } })`.
 */
export async function createLiveEphemeralToken(params: {
  systemInstructions: string;
  model?: string;
}): Promise<LiveEphemeralToken> {
  const model = params.model ?? DEFAULT_LIVE_MODEL;
  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const authToken = await getClient().authTokens.create({
    config: {
      uses: 1,
      expireTime,
      newSessionExpireTime,
      httpOptions: { apiVersion: 'v1alpha' },
      liveConnectConstraints: {
        model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: params.systemInstructions,
          speechConfig: { languageCode: INTERVIEW_LANGUAGE_CODES[0] },
          inputAudioTranscription: {
            languageHints: { languageCodes: INTERVIEW_LANGUAGE_CODES },
          },
          outputAudioTranscription: {
            languageHints: { languageCodes: INTERVIEW_LANGUAGE_CODES },
          },
        },
      },
      lockAdditionalFields: [],
    },
  });

  if (!authToken.name) {
    throw new Error('Gemini did not return an ephemeral token');
  }

  return { token: authToken.name, model, expireTime };
}
