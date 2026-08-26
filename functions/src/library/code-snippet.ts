/**
 * Shared helpers for the live-interview "code snippet question" feature.
 *
 * Domain relevance (is this an IT/technology role?) is intentionally NOT hardcoded here —
 * the interviewer model decides that itself from the role/technologies/skills/topic already
 * present in its system prompt (see interview-prompt.ts) and reports it back at scoring time
 * (see scoring.ts `isTechDomainInterview`). This module only owns the deterministic pieces:
 * how many snippet questions are required for a given session length, and the Gemini Live
 * tool declaration used to capture snippet questions as structured data (instead of trying to
 * parse them out of spoken/transcribed audio).
 */

import { Type, type FunctionDeclaration } from '@google/genai';

export const PRESENT_CODE_SNIPPET_TOOL_NAME = 'present_code_snippet';

/** Structured payload captured from a `present_code_snippet` tool call. */
export interface CodeSnippetPayload {
  code: string;
  language: string;
  questionText: string;
}

/**
 * Minimum number of code-snippet questions required for tech-domain interviews, scaled by
 * session length: 1 per 15 minutes (1 @ 15min, 2 @ 30min, 3 @ 45min, ...), capped at 6 so
 * very long sessions don't over-index on snippets.
 */
export function requiredSnippetQuestionCount(durationMinutes: number): number {
  const minutes = Number.isFinite(durationMinutes) ? durationMinutes : 30;
  return Math.min(6, Math.max(1, Math.round(minutes / 15)));
}

/**
 * Gemini Live function declaration the interviewer model calls whenever it decides to ask a
 * code-snippet question. Keeping the code/language/question as explicit structured fields
 * (rather than inferring them from audio transcription) lets the client render a clean,
 * syntax-aware code block and lets the backend deterministically count snippet questions.
 */
export function buildCodeSnippetTool(): FunctionDeclaration {
  return {
    name: PRESENT_CODE_SNIPPET_TOOL_NAME,
    description:
      'Call this whenever you ask a code-snippet-based interview question. Provide the exact ' +
      'code to display on the candidate\'s screen, its language, and the question you are ' +
      'asking about it (e.g. "What does this function return?", "Find the bug", "What is the ' +
      'output?"). Only call this for technology/software/IT-role interviews — never for ' +
      'non-technical domains.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        code: {
          type: Type.STRING,
          description: 'The exact source code snippet to display, formatted with real line breaks.',
        },
        language: {
          type: Type.STRING,
          description: 'Short language identifier for syntax highlighting, e.g. "javascript", "python", "java", "sql".',
        },
        questionText: {
          type: Type.STRING,
          description: 'The question you are asking the candidate about this snippet.',
        },
      },
      required: ['code', 'language', 'questionText'],
    },
  };
}
