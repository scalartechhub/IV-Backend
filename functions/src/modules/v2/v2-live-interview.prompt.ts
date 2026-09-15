import type {
  InterviewConversationMessage,
  InterviewDoc,
} from '../../interfaces/interview.interface';
import type { V2LiveResumeMode } from './v2-live-interview.persistence';
import {
  compressConversation,
  formatCompressedContextForPrompt,
} from '../live-interview/context-manager';

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max)}...`;

export const formatConversationContext = (
  conversation: InterviewConversationMessage[] | undefined,
): string => {
  const compressed = compressConversation(conversation);
  return formatCompressedContextForPrompt(compressed);
};

export const buildResumeSystemInstruction = (
  baseInstructions: string,
  interview: InterviewDoc,
  resumeMode: V2LiveResumeMode,
): string => {
  const compressed = compressConversation(interview.conversation);
  const conversationContext = formatCompressedContextForPrompt(compressed);

  const isJdInterview = Boolean(interview.config?.jobDescriptionText?.trim());
  const roleName = interview.config?.targetRole || interview.config?.topic || 'the position';
  const company = interview.config?.company?.trim();
  const companyContext = company ? ` at ${company}` : '';

  let resumeBehavior = isJdInterview
    ? `- When the session begins, immediately greet the candidate in ONE short sentence welcoming them to the ${roleName}${companyContext} interview, and immediately ask your first technical or problem-solving question derived directly from the Job Description. Do NOT ask for a resume walkthrough, personal introduction, or career history.`
    : '- When the session begins, immediately greet the candidate, introduce yourself as their AI interviewer, briefly explain how the interview will work, and ask the first question in your opening turn.';

  if (resumeMode === 'await_candidate') {
    resumeBehavior = `- This session is being RESUMED. Prior conversation is provided below.
- Do NOT greet again. Do NOT invent a new question.
- Immediately speak the latest Interviewer question again so the candidate can hear it clearly.
- Repeat that question as closely as possible (same meaning). Do not add scoring commentary.
- After speaking it, wait for the candidate's answer.
- After the candidate answers, ask ONLY the next interviewer question.`;
  } else if (resumeMode === 'generate_next') {
    resumeBehavior = `- This session is being RESUMED. Prior conversation is provided below.
- Do NOT regenerate previous questions.
- Generate ONLY the next interviewer question based on the full conversation.
- Ask ONE new question and wait.`;
  }

  return `${baseInstructions}

Prior conversation:
${conversationContext}

Resume behavior:
${resumeBehavior}`;
};

export const buildResumeKickoffText = (
  resumeMode: V2LiveResumeMode,
  lastAssistantQuestion?: string,
  interview?: InterviewDoc,
): string | null => {
  if (resumeMode === 'fresh') {
    const isJdInterview = Boolean(interview?.config?.jobDescriptionText?.trim());
    if (isJdInterview) {
      const roleName = interview?.config?.targetRole || interview?.config?.topic || 'the position';
      const company = interview?.config?.company?.trim();
      const companyContext = company ? ` at ${company}` : '';
      return [
        `The candidate has just joined the call for the ${roleName}${companyContext} interview based on the Job Description.`,
        `Greet them warmly in ONE brief sentence welcoming them to the ${roleName} interview.`,
        `Then IMMEDIATELY ask your FIRST interview question derived directly from the key responsibilities or technical qualifications in the Job Description.`,
        'Do NOT ask them to introduce themselves or walk through their resume. Start directly with the first JD question now.',
      ].join(' ');
    }

    return 'The candidate has just joined the call and is ready to begin. Greet them briefly and ask your first interview question now — do not wait for them to speak first.';
  }

  if (resumeMode === 'generate_next') {
    return [
      'The interview is being resumed from a saved conversation.',
      'Using ONLY the prior conversation already provided in your system instruction,',
      'generate ONLY the next interviewer question.',
      'Do NOT regenerate previous questions.',
      'Do NOT summarize. Ask one new question only.',
    ].join(' ');
  }

  if (resumeMode === 'await_candidate') {
    const question = lastAssistantQuestion?.trim();
    if (question) {
      return [
        'The interview is being resumed.',
        'Please speak this exact pending interviewer question again so the candidate can hear it:',
        `"${question}"`,
        'Do not ask a different question. Do not summarize. After speaking it, wait for the candidate answer.',
      ].join(' ');
    }

    return [
      'The interview is being resumed.',
      'Speak the latest Interviewer question from the prior conversation again so the candidate can hear it.',
      'Do not ask a new question. After speaking it, wait for the candidate answer.',
    ].join(' ');
  }

  return null;
};
