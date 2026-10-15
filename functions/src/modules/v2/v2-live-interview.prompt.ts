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

import { interviewModeLabel } from '../../services/interview-prompt';

export const extractFirstName = (rawName?: string | null): string => {
  if (!rawName) return '';
  const trimmed = rawName.trim();
  if (/^(candidate|user|anonymous|guest|null|undefined)$/i.test(trimmed)) {
    return '';
  }
  const withoutTitle = trimmed.replace(/^(mr\.?|ms\.?|mrs\.?|dr\.?|prof\.?)\s+/i, '').trim();
  const first = withoutTitle.split(/\s+/)[0] || '';
  if (!first || /^(candidate|user|anonymous|guest|null|undefined)$/i.test(first)) {
    return '';
  }
  if (first === first.toUpperCase() && first.length > 1) {
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }
  return first.charAt(0).toUpperCase() + first.slice(1);
};

export const resolveInterviewSubject = (interview?: InterviewDoc): {
  modeName: string;
  subjectTitle: string;
  candidateName: string;
  candidateFirstName: string;
} => {
  const mode = interview?.mode ?? 'conversational';
  const modeName = interviewModeLabel(mode);
  const targetRole = interview?.config?.targetRole?.trim();
  const topic = interview?.config?.topic?.trim();
  const technologies = interview?.config?.technologies?.filter(Boolean).slice(0, 3).join(', ');
  const company = interview?.config?.company?.trim();
  const rawName = interview?.candidateName?.trim() || '';
  const candidateName = /^(candidate|user|anonymous|guest|null|undefined)$/i.test(rawName) ? '' : rawName;
  const candidateFirstName = extractFirstName(candidateName);

  let subjectTitle = '';
  if (targetRole && company) {
    subjectTitle = `${targetRole} role at ${company}`;
  } else if (targetRole) {
    subjectTitle = `${targetRole} position`;
  } else if (company && topic) {
    subjectTitle = `${company} ${topic} ${modeName}`;
  } else if (topic) {
    subjectTitle = `${topic} ${modeName}`;
  } else if (technologies) {
    subjectTitle = `${technologies} ${modeName}`;
  } else {
    subjectTitle = `${modeName}`;
  }

  return { modeName, subjectTitle, candidateName, candidateFirstName };
};

export const buildResumeSystemInstruction = (
  baseInstructions: string,
  interview: InterviewDoc,
  resumeMode: V2LiveResumeMode,
): string => {
  const compressed = compressConversation(interview.conversation);
  const conversationContext = formatCompressedContextForPrompt(compressed);

  const { modeName, subjectTitle, candidateName, candidateFirstName } = resolveInterviewSubject(interview);
  const isJdInterview = Boolean(interview.config?.jobDescriptionText?.trim());
  const firstQInstruction = isJdInterview
    ? `derive your first question directly from the key responsibilities or technical qualifications in the Job Description.`
    : `ask a strong, engaging opening question relevant to ${subjectTitle}.`;

  const greetingSample = candidateFirstName
    ? `Greet ${candidateFirstName} warmly by their FIRST NAME ONLY (e.g. "Hello ${candidateFirstName}, welcome! I am your AI interviewer."). Never use their full name or last name in the greeting.`
    : `Greet the candidate warmly (e.g. "Hello and welcome! I am your AI interviewer.")`;

  let resumeBehavior = [
    `OPENING TURN STRUCTURE (MANDATORY ON SESSION START):`,
    `When the session begins, you MUST deliver a complete opening response with this exact 3-part flow in ONE continuous turn:`,
    `1. GREETING & INTERVIEW INTRO: ${greetingSample}, and clearly tell them which interview is taking place (e.g. "Today we will be conducting your ${modeName} for the ${subjectTitle}.").`,
    `2. BRIEF ROADMAP (1 sentence): Briefly describe how the interview will work (e.g. "We will go through several questions covering core concepts, technical depth, and practical problem-solving.").`,
    `3. FIRST QUESTION: In the exact same opening response, smoothly transition and ask your FIRST interview question (${firstQInstruction}).`,
    `CRITICAL RULES FOR INTERVIEW DELIVERY:`,
    `- Deliver Greeting (addressing the candidate by their FIRST NAME ONLY: ${candidateFirstName ? `use "${candidateFirstName}", never a full name` : 'no name provided'}), Interview Intro, and Question 1 ALL TOGETHER in your very first response. Do not use their full or last name, and do not stop speaking before asking the question.`,
    `- Do NOT ask the candidate to introduce themselves or walk through their resume/CV; you are the one introducing the interview, then asking question 1.`,
    `- Keep the introduction crisp and natural (2 to 3 sentences maximum before the question) so the candidate can begin answering immediately.`,
    `- NO MARKDOWN IN SPEECH: Never output markdown syntax (**bold**, backticks, # headers, bullet asterisks) in spoken speech. Speak in clean, plain spoken English.`,
    `- ONE QUESTION AT A TIME: Always ask exactly ONE focused question per turn (1–2 sentences). Never ask multi-part or compound questions.`,
    `- RAPID RESPONSE PACING (ZERO DELAY): Respond IMMEDIATELY when the candidate finishes speaking or submits their answer. Never pause or hesitate to conduct complex internal deliberations. Formulate your reaction dynamically like a senior interviewer in a real conversation. Keep each turn short: 1 brief sentence reacting to what they said, plus 1 focused question.`,
    `- REACTIVE INTERVIEWING (CRITICAL): Conduct an intelligent, reactive conversation where every next question builds logically on the candidate's actual answer:`,
    `  * If the candidate gives a good answer: briefly acknowledge their point and ask a deeper follow-up question exploring trade-offs, edge cases, underlying mechanics, or real-world application of that same concept.`,
    `  * If the candidate gives a partial or weak answer: probe their understanding deeper into that same topic without giving away the answer (e.g., "Could you expand on how that works in practice?").`,
    `  * STRICT TOPIC FOCUS: All follow-up questions MUST remain strictly within the designated interview topic, role, and technologies (${subjectTitle}). Never deviate to unrelated domains.`,
    `- REPEATED QUESTION / PARROTING DETECTION (CRITICAL): If the candidate simply repeats or parrots your question back to you instead of answering it (e.g. saying the same question words), explicitly recognize this: "It sounds like you repeated the question rather than answering it." Then immediately ask a fresh, related question within ${subjectTitle}.`,
    `- IRRELEVANT OR OFF-TOPIC ANSWERS: If the candidate says something completely unrelated to the question asked, explicitly state: "What you mentioned seems off-topic and doesn't answer the question." Then immediately pivot to a different question within ${subjectTitle}.`,
    `- NEVER REVEAL ANSWERS: Under no circumstances should you explain the correct answer, give the solution, or teach the candidate. If they answer incorrectly, say "I don't know", or ask for the answer, acknowledge professionally and move forward without disclosing the solution.`,
    `- SESSION CLOSING: Do NOT wrap up early or invent time limitations on your own. Only wrap up when the interview platform sends a time wrap notification or when the candidate explicitly asks to conclude the interview.`,
  ].join('\n');

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
    const { modeName, subjectTitle, candidateName, candidateFirstName } = resolveInterviewSubject(interview);
    const isJdInterview = Boolean(interview?.config?.jobDescriptionText?.trim());
    const firstQPrompt = isJdInterview
      ? `Then in the same turn, ask your FIRST question derived directly from a core responsibility or qualification in the Job Description.`
      : `Then in the same turn, ask your FIRST question to kick off the interview.`;

    const greetingPrompt = candidateFirstName
      ? `In your opening turn, first greet ${candidateFirstName} warmly by their FIRST NAME ONLY (e.g. "Hello ${candidateFirstName}, welcome! I am your AI interviewer."). Do NOT use their full or last name.`
      : `In your opening turn, first greet them warmly and introduce yourself as their AI interviewer.`;

    return [
      `The candidate has just joined the call and is ready to begin.`,
      `${greetingPrompt}`,
      `Explicitly state that today's session is the ${modeName} for the ${subjectTitle}.`,
      `Briefly explain in one sentence how the interview will proceed.`,
      `${firstQPrompt}`,
      `Do NOT ask them to introduce themselves or summarize their resume. Deliver the greeting, interview intro, and question one together now.`,
    ].join(' ');
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
