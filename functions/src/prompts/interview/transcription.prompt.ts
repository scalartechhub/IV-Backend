/** Used to transcribe a candidate answer from recorded audio when the browser caption is empty. */
export const TRANSCRIBE_ANSWER_PROMPT =
  "Transcribe the candidate's spoken English interview answer into plain Latin-script English words only (A-Z). " +
  "Use normal word spacing. Do not use Devanagari, Telugu, Hindi, or any other script. " +
  "Do not summarize, translate into another language, or add commentary. " +
  "If there is no clear speech, return an empty string.";
