/**
 * Sanitize Gemini Live transcription output before UI / Firestore persistence.
 * The Live API can leak internal control tokens like `<ctrl46>` (especially after tool calls).
 */

/** Strip Gemini Live transcription artifacts that must never appear in UI or Firestore. */
export const sanitizeLiveTranscript = (text: string): string =>
  text
    .replace(/<ctrl\d+>/gi, " ")
    .replace(/<\/?(?:noise|inaudible|unk|unknown|silence|other)\s*\/?>/gi, " ")
    .replace(/\[(?:noise|inaudible|unk|unknown|silence|other)\]/gi, " ")
    .replace(/\((?:noise|inaudible|unk|unknown|silence|other)\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

export const containsLiveTranscriptArtifacts = (text: string): boolean =>
  /<ctrl\d+>/i.test(text) ||
  /<\/?(?:noise|inaudible|unk|unknown|silence|other)\s*\/?>/i.test(text);

/** Prefer cleaned output transcription, then model text, then structured tool question text. */
export const resolveAssistantTranscript = (input: {
  outputTranscription?: string;
  modelTurnText?: string;
  snippetQuestionText?: string;
}): string => {
  const candidates = [
    input.outputTranscription,
    input.modelTurnText,
    input.snippetQuestionText,
  ];
  for (const raw of candidates) {
    const cleaned = sanitizeLiveTranscript(String(raw ?? ""));
    if (cleaned) return cleaned;
  }
  return "";
};
