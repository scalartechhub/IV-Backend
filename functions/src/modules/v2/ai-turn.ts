/**
 * One interviewer reply per candidate turn.
 * A second model turn while the candidate still owes an answer is dropped.
 * A blank turn never opens the microphone. Short feedback with no question
 * asks for the question instead of counting as the reply.
 */
export type AiTurnDecision =
  | { action: 'drop' }
  | { action: 'ignore_empty' }
  | { action: 'correct_wrap' }
  | { action: 'nudge_for_question' }
  | { action: 'deliver'; awaitAnswer: boolean };

export const decideAiTurn = (input: {
  text: string;
  /** Candidate has not submitted, or is still speaking. Another interviewer turn must not go out. */
  suppressed: boolean;
  firstSignalReceived: boolean;
  awaitingReply: boolean;
  looksLikeQuestion: boolean;
  alreadyNudged: boolean;
  timeWrapSent: boolean;
  prematureWrap: boolean;
  canPrompt: boolean;
}): AiTurnDecision => {
  if (input.suppressed) return { action: 'drop' };

  const text = input.text.trim();
  if (!text) {
    if (!input.firstSignalReceived || input.awaitingReply) return { action: 'ignore_empty' };
    return { action: 'deliver', awaitAnswer: false };
  }

  if (input.prematureWrap && input.canPrompt) return { action: 'correct_wrap' };

  const words = text.split(/\s+/).filter(Boolean).length;
  if (input.looksLikeQuestion || (input.awaitingReply && words >= 12)) {
    return { action: 'deliver', awaitAnswer: true };
  }

  if (input.awaitingReply && !input.alreadyNudged && !input.timeWrapSent && input.canPrompt) {
    return { action: 'nudge_for_question' };
  }

  return { action: 'deliver', awaitAnswer: false };
};
