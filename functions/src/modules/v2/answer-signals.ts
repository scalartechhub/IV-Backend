/**
 * Cheap, deterministic pre-checks on a submitted candidate answer.
 * Semantic judgement (correct / partial / incorrect / off-topic) stays with the model;
 * these signals only catch cases text heuristics can detect reliably.
 */

export type AnswerSignal =
  | 'no_answer'
  | 'repeat_request'
  | 'asks_for_answer'
  | 'dont_know'
  | 'parroting'
  | 'very_short'
  | 'answered';

const FILLER_WORDS = new Set([
  'um', 'umm', 'uh', 'uhh', 'hmm', 'hm', 'ah', 'er', 'erm', 'okay', 'ok', 'so', 'well', 'yeah',
  'yes', 'no', 'like', 'and', 'the', 'a',
]);

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in', 'on', 'for', 'and', 'or',
  'it', 'its', 'this', 'that', 'you', 'your', 'i', 'me', 'my', 'we', 'do', 'does', 'did', 'can',
  'could', 'would', 'how', 'what', 'why', 'when', 'where', 'which', 'with', 'about', 'so', 'um',
  'uh', 'okay', 'ok',
]);

const REPEAT_REQUEST =
  /\b(repeat|say (that|it) again|come again|pardon|rephrase|didn'?t (get|hear|catch|understand)|what do you mean|can you clarify|could you clarify|not clear|one more time)\b/i;

const ASKS_FOR_ANSWER =
  /\b(what('?s| is| was) the (correct |right )?answer|tell me the (correct |right )?answer|(give|share) me the (answer|solution)|what should (i|it) (have )?(said|say|be))\b/i;

const DONT_KNOW =
  /\b(i (really )?(don'?t|do not) know|no idea|not sure|i'?m not aware|not familiar|never (used|worked|heard)|i (can'?t|cannot) (answer|recall|remember)|skip( this)?( question)?|next question|move on|i'?ll pass|^pass)\b/i;

const END_REQUEST =
  /\b(end|finish|stop|wrap up|conclude)\b.{0,20}\b(interview|session|call|here|now|it)\b|\bno more questions\b|\bthat'?s all\b|\bwe can stop\b/i;

/** Candidate asked to finish, so the interviewer closing early is expected. */
export const candidateWantsToEnd = (answer: string): boolean => END_REQUEST.test(answer);

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

const contentWords = (text: string): string[] => words(text).filter((w) => !STOP_WORDS.has(w));

const isParroting = (question: string, answer: string): boolean => {
  const answerTokens = contentWords(answer);
  const questionTokens = new Set(contentWords(question));
  if (answerTokens.length < 3 || questionTokens.size === 0) return false;
  if (answerTokens.length > questionTokens.size + 3) return false;
  const overlap = answerTokens.filter((w) => questionTokens.has(w)).length;
  return overlap / answerTokens.length >= 0.8;
};

export const classifyCandidateAnswer = (lastQuestion: string, answer: string): AnswerSignal => {
  const text = answer.trim();
  const allWords = words(text);
  if (!allWords.length || allWords.every((w) => FILLER_WORDS.has(w))) return 'no_answer';

  const isShort = allWords.length <= 25;
  if (isShort && ASKS_FOR_ANSWER.test(text)) return 'asks_for_answer';
  if (isShort && REPEAT_REQUEST.test(text)) return 'repeat_request';
  if (isShort && DONT_KNOW.test(text)) return 'dont_know';
  if (lastQuestion && isParroting(lastQuestion, text)) return 'parroting';
  if (allWords.length < 4) return 'very_short';
  return 'answered';
};

export const describeAnswerSignal = (signal: AnswerSignal): string | null => {
  switch (signal) {
    case 'no_answer':
      return 'No real answer was captured (silence or filler words only). If you clearly heard a spoken answer in the audio, judge that instead.';
    case 'repeat_request':
      return 'The candidate is asking you to repeat or clarify the question.';
    case 'asks_for_answer':
      return 'The candidate is asking you for the correct answer.';
    case 'dont_know':
      return 'The candidate says they do not know or wants to skip. If they still attempted an answer, judge the attempt instead.';
    case 'parroting':
      return 'The candidate mostly repeated your question back instead of answering it.';
    case 'very_short':
      return 'The answer is only a few words — check whether it actually answers the question.';
    default:
      return null;
  }
};
