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
    .replace(/[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0D80-\u0DFF\u0600-\u06FF\u0750-\u077F]/g, " ")
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
  const latinCount = (cleaned.match(/[\u0000-\u024F\u1E00-\u1EFF]/g) ?? []).length;
  if (latinCount / cleaned.length >= 0.5) return true;
  if (INDIC_OR_NON_LATIN_SCRIPT.test(cleaned)) return false;
  const nonLatin = (cleaned.match(/[^\u0000-\u024F\u1E00-\u1EFF]/g) ?? []).length;
  return nonLatin / cleaned.length < 0.2;
};

/**
 * Append a Gemini Live transcription chunk.
 * Chunks are usually incremental, but some turns resend the text so far — don't double it.
 */
export const appendTranscriptChunk = (buffer: string, chunk: string): string => {
  const cur = (buffer ?? "").replace(/\s+/g, " ").trim();
  const next = (chunk ?? "").replace(/\s+/g, " ").trim();
  if (!next) return cur;
  if (!cur) return next;
  const curLower = cur.toLowerCase();
  const nextLower = next.toLowerCase();
  if (nextLower.startsWith(curLower)) return next;
  if (curLower.startsWith(nextLower) || curLower.endsWith(nextLower)) return cur;
  return `${cur} ${next}`.replace(/\s+/g, " ").trim();
};

/**
 * True when the caption is long enough to be the speech in this audio.
 * Live captions often keep only a fragment of a long answer.
 */
/**
 * RMS floor for a 20 ms frame to count as speech.
 * 0.015 treated quiet headset audio as silence, so a real answer was never measured.
 */
export const SPEECH_FRAME_RMS = 0.008;

/** Seconds of PCM16 mono audio that contain speech (20 ms frames above a loudness floor). */
export const estimateSpeechSec = (pcm16le: Buffer, sampleRate = 16000): number => {
  const frameSamples = Math.floor(sampleRate * 0.02);
  const totalSamples = Math.floor(pcm16le.length / 2);
  let voicedFrames = 0;
  for (let start = 0; start + frameSamples <= totalSamples; start += frameSamples) {
    let sumSquares = 0;
    for (let i = start; i < start + frameSamples; i++) {
      const sample = pcm16le.readInt16LE(i * 2) / 32768;
      sumSquares += sample * sample;
    }
    if (Math.sqrt(sumSquares / frameSamples) > SPEECH_FRAME_RMS) voicedFrames++;
  }
  return voicedFrames * 0.02;
};

/** Browser captions often drop chunks of long answers; ~2 words/sec of speech is the floor for a full caption. */
export const captionLooksIncomplete = (caption: string, speechSec: number): boolean => {
  const words = caption.trim().split(/\s+/).filter(Boolean).length;
  if (speechSec < 3) return words === 0;
  return words < speechSec * 1.2;
};

export const captionCoversAudio = (text: string, durationSec: number): boolean => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (durationSec < 1.5) return words.length > 0;
  return words.length >= Math.max(5, Math.floor(durationSec * 0.65));
};

/**
 * Merge a sliding-window transcript (last ~2s of audio) into the caption so far.
 * The window re-hears the tail of the answer, so overlap is replaced, not duplicated.
 */
export const mergeSlidingWindowCaption = (committed: string, windowText: string): string => {
  const a = sanitizeLiveTranscript(committed);
  const b = sanitizeLiveTranscript(windowText);
  if (!b) return a;
  if (!a) return b;
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  if (bLower.startsWith(aLower) || bLower.includes(aLower)) return b;
  if (aLower.includes(bLower)) return a;

  const aWords = a.split(/\s+/).filter(Boolean);
  const bWords = b.split(/\s+/).filter(Boolean);
  const max = Math.min(aWords.length, bWords.length, 12);
  for (let n = max; n >= 2; n--) {
    const suffix = aWords.slice(-n).join(" ").toLowerCase();
    const prefix = bWords.slice(0, n).join(" ").toLowerCase();
    if (suffix === prefix) {
      return `${aWords.slice(0, -n).join(" ")} ${b}`.replace(/\s+/g, " ").trim();
    }
  }
  return `${a} ${b}`.replace(/\s+/g, " ").trim();
};

/** Keep the caption that already contains the other; otherwise preserve primary. */
export const preferRicherCaption = (primary: string, secondary: string): string => {
  const a = sanitizeLiveTranscript(primary);
  const b = sanitizeLiveTranscript(secondary);
  if (!a) return b;
  if (!b) return a;
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  if (aLower.includes(bLower)) return a;
  if (bLower.includes(aLower)) return b;
  return a;
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
