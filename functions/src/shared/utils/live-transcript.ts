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

/**
 * Indic + other non-Latin scripts Gemini sometimes emits for Indian-accented English
 * (Telugu, Devanagari/Hindi, Bengali, Tamil, Gujarati, Kannada, Malayalam, etc.).
 */
const INDIC_OR_NON_LATIN_SCRIPT =
  /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0D80-\u0DFF\u0600-\u06FF\u0750-\u077F]/;

/** True when caption is usable English (Latin script), not Telugu/Hindi phonetic misdetection. */
export const isLatinEnglishCaption = (text: string): boolean => {
  const cleaned = text.replace(/\s+/g, "");
  if (!cleaned) return false;
  if (INDIC_OR_NON_LATIN_SCRIPT.test(cleaned)) return false;
  const nonLatin = (cleaned.match(/[^\u0000-\u024F\u1E00-\u1EFF]/g) ?? []).length;
  return nonLatin / cleaned.length < 0.15;
};

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
