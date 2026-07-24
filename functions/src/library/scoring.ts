/**
 * Interview scoring via Gemini text model with runtime shape validation.
 */

import { z } from 'zod';
import type { InterviewConfig } from '../interfaces/interview.interface';
import type { InterviewResults } from '../interfaces/interview.interface';
import { generateJson } from './gemini-client';

const scoreInterviewSchema = z.object({
  overallScore: z.number().min(0).max(100),
  technicalScore: z.number().min(0).max(100),
  communicationScore: z.number().min(0).max(100),
  confidenceScore: z.number().min(0).max(100),
  problemSolvingScore: z.number().min(0).max(100),
  codingScore: z.number().min(0).max(100).optional(),
  behaviorScore: z.number().min(0).max(100).optional(),
  skillDeltas: z.record(z.string(), z.number()),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  recommendations: z.array(z.string()),
  nextLearningPathId: z.string().optional(),
});

export type ScoreInterviewResult = z.infer<typeof scoreInterviewSchema>;

const SCORING_SYSTEM_PROMPT = `You are an expert interview evaluator.
Respond ONLY with valid JSON matching this shape:
{
  "overallScore": number 0-100,
  "technicalScore": number 0-100,
  "communicationScore": number 0-100,
  "confidenceScore": number 0-100,
  "problemSolvingScore": number 0-100,
  "codingScore": number 0-100 (optional),
  "behaviorScore": number 0-100 (optional),
  "skillDeltas": { "technical": number, "communication": number, "confidence": number, "problemSolving": number, "coding": number, "behavior": number },
  "strengths": string[],
  "weaknesses": string[],
  "recommendations": string[]
}
skillDeltas should be small integers typically in [-8, +8]. No markdown.`;

/**
 * Score an interview from a transcript summary + config. Validates LLM JSON before return.
 */
export async function scoreInterview(params: {
  transcriptSummary: string;
  config: InterviewConfig;
  mode: string;
}): Promise<InterviewResults> {
  const userPrompt = JSON.stringify({
    mode: params.mode,
    config: params.config,
    transcriptSummary: params.transcriptSummary,
  });

  const raw = await generateJson<unknown>({
    systemInstruction: SCORING_SYSTEM_PROMPT,
    userPrompt,
  });

  const parsed = scoreInterviewSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid scoring response from Gemini: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}

/**
 * Validate a candidate scoring object without calling Gemini (for tests / fallbacks).
 */
export function validateScoreShape(value: unknown): ScoreInterviewResult {
  return scoreInterviewSchema.parse(value);
}
