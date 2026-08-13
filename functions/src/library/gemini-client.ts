/**
 * Thin Gemini client shared by Cloud Functions (text scoring / resume / roadmap) and the
 * v2 live-interview WebSocket bridge (modules/v2/live-interview-ws.ts).
 */

import { GoogleGenAI, Modality } from '@google/genai';
import { firestoreConfigService } from '../config/firestore-config.service';

import { AppError } from '../shared/utils';

const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

/** Faster model for resume scoring when set (e.g. gemini-2.0-flash). */
export const RESUME_GEMINI_MODEL =
  process.env.RESUME_GEMINI_MODEL ?? DEFAULT_MODEL;

const supportsThinkingConfig = (model: string): boolean =>
  /gemini-2\./i.test(model);

let client: GoogleGenAI | null = null;
let currentApiKey: string | null = null;

/** Shared GoogleGenAI client, reused by text generation and the v2 live WS bridge. */
export function getClient(): GoogleGenAI {
  const config = firestoreConfigService.getGenAIConfig();
  const apiKey = (config.apiKey || process.env.GEMINI_API_KEY || '').trim();

  if (!apiKey) {
    throw new AppError(
      503,
      'GEMINI_API_KEY is not configured. Please set a valid Google AI Studio API key in Firestore collection "config", document "genai".',
    );
  }

  if (!client || currentApiKey !== apiKey) {
    currentApiKey = apiKey;
    client = new GoogleGenAI({ apiKey });
  }

  return client;
}

const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

/**
 * Generate structured JSON from a system + user prompt pair.
 * Automatically retries across fallback models if a model experiences high demand (HTTP 503).
 */
export async function generateJson<T>(params: {
  systemInstruction: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<T> {
  const rawModel = params.model ?? firestoreConfigService.getGenAIConfig().model ?? DEFAULT_MODEL;
  const primaryModel = /gemini-/i.test(rawModel) ? rawModel : 'gemini-2.5-flash';

  const modelsToTry = [
    primaryModel,
    ...FALLBACK_MODELS.filter((m) => m !== primaryModel),
  ];

  let lastErr: unknown = null;

  for (const model of modelsToTry) {
    try {
      const result = await getClient().models.generateContent({
        model,
        contents: params.userPrompt,
        config: {
          systemInstruction: params.systemInstruction,
          temperature: params.temperature ?? 0.2,
          maxOutputTokens: params.maxOutputTokens ?? 4096,
          responseMimeType: 'application/json',
          // Gemini 2.5+ thinking tokens add latency and burn output budget on JSON tasks.
          ...(supportsThinkingConfig(model)
            ? { thinkingConfig: { thinkingBudget: 0 } }
            : {}),
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
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || err);

      if (
        msg.includes('401') ||
        msg.includes('UNAUTHENTICATED') ||
        msg.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED') ||
        msg.includes('invalid authentication credentials') ||
        msg.includes('API_KEY_INVALID')
      ) {
        // Invalidate memory cache & client instance so next call re-fetches latest key from Firestore
        client = null;
        currentApiKey = null;
        firestoreConfigService.clearCache();

        throw new AppError(
          401,
          'Gemini API Authentication Failed: The API key in Firestore (config/genai) or .env is invalid, unauthorized, or expired. Please set a valid Google AI Studio Key (starting with AIzaSy...) at https://aistudio.google.com/app/apikey and update Firestore collection "config", document "genai".',
        );
      }

      const isHighDemand =
        msg.includes('503') ||
        msg.includes('high demand') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('overloaded');

      if (isHighDemand && model !== modelsToTry[modelsToTry.length - 1]) {
        console.warn(
          `[gemini-client] Model "${model}" is experiencing high demand, retrying with fallback model...`,
        );
        continue;
      }

      throw err;
    }
  }

  const lastMsg = String((lastErr as any)?.message || lastErr);
  if (
    lastMsg.includes('503') ||
    lastMsg.includes('high demand') ||
    lastMsg.includes('UNAVAILABLE')
  ) {
    throw new AppError(
      503,
      'Gemini AI is currently experiencing high demand across all models. Spikes in demand are temporary, please try again in a few moments.',
    );
  }

  throw lastErr;
}

export const DEFAULT_LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL ?? 'gemini-2.5-flash-native-audio-preview-12-2025';

/**
 * Without an explicit language, Gemini Live auto-detects language per utterance and can
 * mis-transcribe accented English as Hindi/Marathi, confusing the interviewer model. Pin both
 * transcription and speech synthesis to English so answers are recognized/replied to consistently.
 */
export const INTERVIEW_LANGUAGE_CODES = ['en-US', 'en-IN'];

/**
 * Gemini Live otherwise waits silently for the candidate to speak first. With automatic VAD
 * disabled, the bridge kicks off via sendClientContent({ turnComplete: true }) using this text
 * so the interviewer greets and asks the opening question without waiting for the candidate.
 */
export const LIVE_KICKOFF_MESSAGE =
  'The candidate has just joined the call and is ready to begin. Greet them briefly and ask ' +
  'your first interview question now — do not wait for them to speak first.';

/**
 * Build Gemini Live client-side session config (instructions only — no live handling).
 * Still returned as informational metadata from /v2/interviews/start.
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

/**
 * Gemini `live.connect` config for the v2 server-side WebSocket bridge: audio-only responses,
 * English pinned for transcription/speech (see INTERVIEW_LANGUAGE_CODES), with live transcripts
 * enabled on both sides so the bridge can relay captions to the browser.
 */
export function buildLiveConnectConfig(systemInstructions: string) {
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: systemInstructions,
    speechConfig: { languageCode: INTERVIEW_LANGUAGE_CODES[0] },
    inputAudioTranscription: {
      languageHints: { languageCodes: INTERVIEW_LANGUAGE_CODES },
    },
    outputAudioTranscription: {
      languageHints: { languageCodes: INTERVIEW_LANGUAGE_CODES },
    },
    // Client controls turn boundaries via activityStart/activityEnd so long answers with
    // thinking pauses are not cut off by Gemini's default automatic VAD.
    realtimeInputConfig: {
      automaticActivityDetection: { disabled: true },
    },
  };
}
