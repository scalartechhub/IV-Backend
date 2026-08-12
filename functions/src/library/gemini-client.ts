/**
 * Thin Gemini client shared by Cloud Functions (text scoring / resume / roadmap) and the
 * v2 live-interview WebSocket bridge (modules/v2/live-interview-ws.ts).
 */

import { GoogleGenAI, Modality } from '@google/genai';
import { firestoreConfigService } from '../config/firestore-config.service';

const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

/** Faster model for resume scoring when set (e.g. gemini-2.0-flash). */
export const RESUME_GEMINI_MODEL =
  process.env.RESUME_GEMINI_MODEL ?? DEFAULT_MODEL;

const supportsThinkingConfig = (model: string): boolean =>
  /gemini-2\./i.test(model);

let client: GoogleGenAI | null = null;

/** Shared GoogleGenAI client, reused by text generation and the v2 live WS bridge. */
export function getClient(): GoogleGenAI {
  if (!client) {
    const config = firestoreConfigService.getGenAIConfig();
    const apiKey = config.apiKey || process.env.GEMINI_API_KEY;
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
  const model = params.model ?? DEFAULT_MODEL;
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
