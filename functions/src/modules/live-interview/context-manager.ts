/**
 * Rolling context manager for live interviews.
 *
 * Compresses older conversation turns into structured summaries while keeping
 * recent turns in full. This allows sessions to support ~1,000+ words of
 * active context instead of the ~300-word limit caused by replaying the
 * entire conversation in both the system instruction and sendClientContent.
 *
 * Strategy:
 * - Recent turns (last RECENT_TURNS_WINDOW messages) are kept verbatim for
 *   continuity and replayed via sendClientContent on resume.
 * - Older turns are compressed into a Q&A summary: full question text +
 *   truncated answer text.
 * - A separate "questions asked" list prevents the AI from repeating topics.
 * - Key technical claims from candidate answers are extracted and preserved
 *   so the AI can check for consistency and probe further.
 */

/** Normalized conversation entry used by the context manager. */
export interface ContextEntry {
  role: "assistant" | "candidate";
  text: string;
}

/** Result of compressing a conversation for rolling context. */
export interface CompressedConversation {
  /** Structured summary of older turns (embedded in the system instruction). */
  olderContextSummary: string;
  /** Recent turns to replay in full via sendClientContent. */
  recentTurns: ContextEntry[];
  /** All interviewer questions asked so far (prevents repetition). */
  questionsAsked: string[];
  /** Key technical claims made by the candidate (for consistency checking). */
  technicalClaims: string[];
  /** Total number of conversation turns. */
  totalTurns: number;
  /** Whether compression was actually applied (false when conversation fits within window). */
  compressed: boolean;
}

// ─── Configuration ────────────────────────────────────────────────────

/** Keep the last N messages in full (e.g. 8 = 4 Q&A pairs). */
const RECENT_TURNS_WINDOW = 8;
/** Max characters per candidate answer in the older-turn summary. */
const ANSWER_SUMMARY_MAX_CHARS = 250;
/** Max characters per interviewer question in the older-turn summary. */
const QUESTION_SUMMARY_MAX_CHARS = 200;
/** Hard cap on the total older-context summary block. */
const MAX_OLDER_SUMMARY_CHARS = 4_000;
/** Max chars for a "questions asked" line item. */
const QUESTION_LIST_MAX_CHARS = 120;
/** Min candidate answer length to consider extracting a technical claim. */
const MIN_CLAIM_LENGTH = 40;

// ─── Helpers ──────────────────────────────────────────────────────────

const normalizeRole = (role: string): "assistant" | "candidate" => {
  if (role === "assistant" || role === "ai" || role === "model") return "assistant";
  return "candidate";
};

const getText = (entry: { text?: string; message?: string }): string =>
  (entry.text ?? (entry as Record<string, unknown>).message as string ?? "").trim();

const truncateText = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars).trimEnd()}…`;

/**
 * Extract key technical claims from a candidate answer.
 *
 * Looks for sentences that contain assertion-like patterns:
 * technology names, version numbers, comparisons, "because", "works by", etc.
 * Returns up to 3 short claim strings per answer.
 */
const extractClaimsFromAnswer = (text: string): string[] => {
  if (text.length < MIN_CLAIM_LENGTH) return [];

  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20);

  const claimPatterns =
    /\b(because|works by|is used for|difference between|instead of|better than|faster than|allows|enables|provides|ensures|prevents|requires|supports|uses|implements|extends|overrides|replaces|v\d|\d+\.\d+)\b/i;

  const claims: string[] = [];
  for (const sentence of sentences) {
    if (claimPatterns.test(sentence)) {
      claims.push(truncateText(sentence, 120));
      if (claims.length >= 3) break;
    }
  }

  return claims;
};

// ─── Main API ─────────────────────────────────────────────────────────

/**
 * Compress a conversation into rolling context.
 *
 * Accepts either v1 entries (`{ role, message }`) or v2 entries (`{ role, text }`).
 */
export const compressConversation = (
  conversation: Array<{ role: string; text?: string; message?: string }> | undefined,
  recentWindow = RECENT_TURNS_WINDOW,
): CompressedConversation => {
  if (!conversation?.length) {
    return {
      olderContextSummary: "",
      recentTurns: [],
      questionsAsked: [],
      technicalClaims: [],
      totalTurns: 0,
      compressed: false,
    };
  }

  // Normalize all entries to a common shape.
  const normalized: ContextEntry[] = conversation
    .map((entry) => ({ role: normalizeRole(entry.role), text: getText(entry) }))
    .filter((e) => e.text.length > 0);

  const allQuestions = normalized
    .filter((e) => e.role === "assistant")
    .map((e) => e.text);

  // If the conversation fits within the window, no compression needed.
  if (normalized.length <= recentWindow) {
    const claims = normalized
      .filter((e) => e.role === "candidate")
      .flatMap((e) => extractClaimsFromAnswer(e.text));

    return {
      olderContextSummary: "",
      recentTurns: normalized,
      questionsAsked: allQuestions,
      technicalClaims: claims,
      totalTurns: normalized.length,
      compressed: false,
    };
  }

  const olderTurns = normalized.slice(0, -recentWindow);
  const recentTurns = normalized.slice(-recentWindow);

  // ── Build structured summary of older turns ──
  const summaryParts: string[] = [];
  let questionIndex = 0;

  for (const turn of olderTurns) {
    if (turn.role === "assistant") {
      questionIndex++;
      summaryParts.push(
        `Q${questionIndex}: ${truncateText(turn.text, QUESTION_SUMMARY_MAX_CHARS)}`,
      );
    } else {
      summaryParts.push(
        `A${questionIndex}: ${truncateText(turn.text, ANSWER_SUMMARY_MAX_CHARS)}`,
      );
    }
  }

  let olderContextSummary = summaryParts.join("\n");
  if (olderContextSummary.length > MAX_OLDER_SUMMARY_CHARS) {
    olderContextSummary =
      olderContextSummary.slice(0, MAX_OLDER_SUMMARY_CHARS) +
      "\n[earlier turns truncated for brevity]";
  }

  // ── Extract technical claims from ALL candidate answers ──
  const technicalClaims = normalized
    .filter((e) => e.role === "candidate")
    .flatMap((e) => extractClaimsFromAnswer(e.text));

  return {
    olderContextSummary,
    recentTurns,
    questionsAsked: allQuestions,
    technicalClaims,
    totalTurns: normalized.length,
    compressed: true,
  };
};

/**
 * Format compressed context for inclusion in a system instruction.
 *
 * Produces a human-readable block that includes:
 * - Older turn summary (if compressed)
 * - Recent conversation in full
 * - Questions-asked list (for non-repetition)
 * - Technical claims (for consistency checking)
 */
export const formatCompressedContextForPrompt = (
  compressed: CompressedConversation,
): string => {
  if (compressed.totalTurns === 0) {
    return "No prior conversation.";
  }

  const sections: string[] = [];

  // Older turn summary
  if (compressed.compressed && compressed.olderContextSummary) {
    sections.push(
      `=== Earlier conversation summary (${compressed.totalTurns - compressed.recentTurns.length} messages, compressed) ===`,
      compressed.olderContextSummary,
    );
  }

  // Recent turns in full
  if (compressed.recentTurns.length > 0) {
    const header = compressed.compressed
      ? `=== Recent conversation (last ${compressed.recentTurns.length} messages — full context) ===`
      : "=== Conversation so far ===";
    sections.push(header);
    for (const turn of compressed.recentTurns) {
      const speaker = turn.role === "assistant" ? "Interviewer" : "Candidate";
      sections.push(`${speaker}: ${turn.text}`);
    }
  }

  // Questions-asked list
  if (compressed.questionsAsked.length > 0) {
    sections.push(
      `\nQuestions already asked (${compressed.questionsAsked.length} total — do NOT repeat these):`,
    );
    for (let i = 0; i < compressed.questionsAsked.length; i++) {
      sections.push(`${i + 1}. ${truncateText(compressed.questionsAsked[i], QUESTION_LIST_MAX_CHARS)}`);
    }
  }

  // Technical claims for consistency
  if (compressed.technicalClaims.length > 0) {
    sections.push(
      `\nCandidate's key technical claims (verify consistency, challenge if contradicted):`,
    );
    for (const claim of compressed.technicalClaims.slice(0, 15)) {
      sections.push(`• ${claim}`);
    }
  }

  return sections.join("\n");
};

/**
 * Utility to get only the turns that should be replayed to Gemini via
 * sendClientContent on session resume. Maps roles to Gemini's expected format.
 */
export const getReplayTurns = (
  compressed: CompressedConversation,
): Array<{ role: "model" | "user"; parts: Array<{ text: string }> }> =>
  compressed.recentTurns.map((turn) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: [{ text: turn.text }],
  }));
