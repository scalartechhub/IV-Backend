/**
 * Two-tier confidence scoring + hiring probability composite.
 * Tier 1 (text) always runs via Gemini scoring. Tier 2a/2b are optional stubs.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { DominantEmotion, FaceSignalDoc } from '../interfaces/interview.interface';
import { faceSignalsCol } from '../utils/firestore-refs';

export interface ConfidenceSignals {
  textSignal: number;
  audioSignal?: number;
  facialSignal?: number;
}

export interface RawGeminiScores {
  overallScore: number;
  technicalScore: number;
  communicationScore: number;
  confidenceScore: number;
  problemSolvingScore: number;
}

export interface HiringProbabilityInput {
  overallScore: number;
  technicalScore: number;
  communicationScore: number;
  confidenceScore: number;
  problemSolvingScore: number;
  resumeScore?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Tier 1 — always available. Uses Gemini's confidenceScore from the same scoring call
 * (hedging / assertiveness). No extra API call.
 */
export function calculateTextConfidence(
  _transcriptSummary: string,
  geminiScores: RawGeminiScores,
): number {
  return clamp(Math.round(geminiScores.confidenceScore), 0, 100);
}

/**
 * Tier 2a — optional. Only call if an audio-analytics API key is configured.
 * TODO: wire to Hume AI / AssemblyAI / Deepgram once chosen.
 * Audio is NOT persisted by default; enabling this means temporarily buffering then discarding.
 */
export async function calculateAudioConfidence(
  _interviewId: string,
): Promise<number | null> {
  if (!process.env.AUDIO_ANALYTICS_API_KEY) {
    return null;
  }
  // TODO: provider integration — pitch variance, pause frequency, speech-rate steadiness → 0-100
  return null;
}

/**
 * Map faceSignals emotion aggregates to a 0-100 confidence score.
 * Returns null if the subcollection is empty (camera off / opted out).
 */
export function aggregateFacialConfidence(
  signals: Array<Pick<FaceSignalDoc, 'dominantEmotion' | 'emotionScores'>>,
): number | null {
  if (signals.length === 0) return null;

  let confidentWeight = 0;
  let nervousPenalty = 0;

  for (const signal of signals) {
    const scores = signal.emotionScores;
    const confident =
      (scores.confident ?? 0) + (scores.calm ?? 0) + (scores.neutral ?? 0);
    const nervous =
      (scores.nervous ?? 0) +
      (scores.confused ?? 0) +
      (scores.fear ?? 0) +
      (scores.angry ?? 0);

    const dominant: DominantEmotion = signal.dominantEmotion;
    if (dominant === 'confident' || dominant === 'neutral') {
      confidentWeight += 1;
    } else if (dominant === 'nervous' || dominant === 'confused') {
      nervousPenalty += 1;
    }

    confidentWeight += confident / 100;
    nervousPenalty += nervous / 100;
  }

  const n = signals.length;
  const raw = ((confidentWeight - nervousPenalty * 0.75) / n) * 50 + 50;
  return clamp(Math.round(raw), 0, 100);
}

/**
 * Tier 2b — optional. Reads interviews/{id}/faceSignals/* emotion aggregates (never raw images).
 */
export async function calculateFacialConfidence(
  db: Firestore,
  interviewId: string,
): Promise<number | null> {
  const snap = await faceSignalsCol(db, interviewId).limit(200).get();
  if (snap.empty) return null;
  const signals = snap.docs.map((d) => d.data());
  return aggregateFacialConfidence(signals);
}

/**
 * Combines whichever signals are available into one score. Weights shift if a signal is missing.
 */
export function combineConfidenceSignals(signals: ConfidenceSignals): number {
  const weights: Record<keyof ConfidenceSignals, number> = {
    textSignal: 1,
    audioSignal: 0,
    facialSignal: 0,
  };

  if (signals.audioSignal != null) {
    weights.textSignal = 0.5;
    weights.audioSignal = 0.5;
  }
  if (signals.facialSignal != null) {
    weights.textSignal = signals.audioSignal != null ? 0.34 : 0.5;
    weights.audioSignal = signals.audioSignal != null ? 0.33 : 0;
    weights.facialSignal = signals.audioSignal != null ? 0.33 : 0.5;
  }

  let score = signals.textSignal * weights.textSignal;
  if (signals.audioSignal != null) {
    score += signals.audioSignal * weights.audioSignal;
  }
  if (signals.facialSignal != null) {
    score += signals.facialSignal * weights.facialSignal;
  }
  return Math.round(score);
}

/**
 * Full confidence pipeline: text (always) + optional audio/facial.
 */
export async function calculateConfidence(params: {
  db: Firestore;
  interviewId: string;
  transcriptSummary: string;
  geminiScores: RawGeminiScores;
}): Promise<number> {
  const textSignal = calculateTextConfidence(
    params.transcriptSummary,
    params.geminiScores,
  );
  const [audioSignal, facialSignal] = await Promise.all([
    calculateAudioConfidence(params.interviewId),
    calculateFacialConfidence(params.db, params.interviewId),
  ]);

  return combineConfidenceSignals({
    textSignal,
    ...(audioSignal != null ? { audioSignal } : {}),
    ...(facialSignal != null ? { facialSignal } : {}),
  });
}

/**
 * Hiring probability — weighted composite, NOT a 3rd-party call.
 */
export function calculateHiringProbability(input: HiringProbabilityInput): number {
  const WEIGHTS = {
    overall: 0.3,
    technical: 0.2,
    communication: 0.15,
    confidence: 0.1,
    problemSolving: 0.1,
    resume: 0.15,
  };
  const resume = input.resumeScore ?? input.overallScore;
  const raw =
    input.overallScore * WEIGHTS.overall +
    input.technicalScore * WEIGHTS.technical +
    input.communicationScore * WEIGHTS.communication +
    input.confidenceScore * WEIGHTS.confidence +
    input.problemSolvingScore * WEIGHTS.problemSolving +
    resume * WEIGHTS.resume;
  return Math.round(clamp(raw, 0, 100));
}
