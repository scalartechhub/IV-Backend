import type {
  InterviewConversationMessage,
  InterviewDoc,
} from '../../interfaces/interview.interface';
import type { V2LiveResumeMode } from '../../modules/v2/v2-live-interview.persistence';
import {
  compressConversation,
  formatCompressedContextForPrompt,
} from '../../modules/live-interview/context-manager';

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max)}...`;

export const formatConversationContext = (
  conversation: InterviewConversationMessage[] | undefined,
): string => {
  const compressed = compressConversation(conversation);
  return formatCompressedContextForPrompt(compressed);
};

import { interviewModeLabel } from './interview-system.prompt';

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
  const questionSource = resolveQuestionSource(interview);
  const firstQInstruction =
    questionSource === 'jd'
      ? `derive your first question directly from the key responsibilities or technical qualifications in the Job Description.`
      : questionSource === 'resume'
        ? `ask about ONE specific project, role, or achievement from the candidate's resume signals, naming it (e.g. "I see you worked on X — how did you …?").`
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
  ].join('\n');

  const conversationRules = [
    `CONVERSATION RULES (ALWAYS APPLY):`,
    `- NO MARKDOWN IN SPEECH: Never output markdown syntax (**bold**, backticks, # headers, bullet asterisks) in spoken speech. Speak in clean, plain spoken English.`,
    `- ONE QUESTION AT A TIME: Always ask exactly ONE focused question per turn (1–2 sentences). Never ask multi-part or compound questions.`,
    `- RAPID RESPONSE PACING (ZERO DELAY): Respond IMMEDIATELY when the candidate finishes speaking or submits their answer. Keep each turn short: 1 brief sentence of feedback on their answer, plus 1 question.`,
    `- EVALUATE, THEN RESPOND (MANDATORY): Before every reply, judge whether their answer was correct, partial, incorrect, unrelated, or empty.`,
    `  * Correct → name what they got right, then ask the next question built on their answer (deeper, or a closely connected concept). After 2–3 questions on one thread, move to the next topic${questionSource === 'resume' ? ' from their resume' : questionSource === 'jd' ? ' from the Job Description' : ''}.`,
    `  * Partial → say what they covered and ask for the missing part of the same question.`,
    `  * Incorrect → tell them politely that it is not quite right (without giving the answer) and ask them to reconsider that point.`,
    `  * Unrelated / off-topic → tell them it did not answer what you asked, then re-ask the same question in simpler words.`,
    `  * Empty or parroting → tell them you did not get an answer (or that they repeated the question), then re-ask in simpler words.`,
    `  * Never re-ask the same question a third time — after one redirect, say "Let's move on" and ask a different question.`,
    `  * STRICT TOPIC FOCUS: Stay inside ${subjectTitle} and the stated technologies.`,
    `- NEVER REVEAL ANSWERS: Under no circumstances should you explain the correct answer, give the solution, or teach the candidate.`,
    `- SESSION LENGTH: Keep the interview going for the full session. Never mention time, never say you are done, and never wrap up on your own — not even if the candidate struggles or asks for "another question" (just ask one on a new topic). Only wrap up when the interview platform sends a time wrap notification or the candidate explicitly asks to end the interview.`,
    `- NEVER RUN OUT OF QUESTIONS: When a topic is exhausted, move to another uncovered skill, technology, ${questionSource === 'resume' ? 'resume item, ' : questionSource === 'jd' ? 'JD requirement, ' : ''}or fundamental concept relevant to ${subjectTitle}.`,
  ].join('\n');

  if (resumeMode === 'await_candidate') {
    resumeBehavior = `- This session is being RESUMED. Prior conversation is provided below.
- Do NOT greet again. Do NOT invent a new question.
- Immediately speak the latest Interviewer question again so the candidate can hear it clearly.
- Repeat that question as closely as possible (same meaning). Do not add scoring commentary.
- After speaking it, wait for the candidate's answer.
- After the candidate answers, follow up interactively on what they said — do not invent an unrelated new question.`;
  } else if (resumeMode === 'generate_next') {
    resumeBehavior = `- This session is being RESUMED. Prior conversation is provided below.
- Do NOT regenerate previous questions.
- Generate ONLY the next interviewer turn based on the full conversation: follow up on the candidate's last answer if it was a real attempt.
- Ask ONE question and wait. Do not skip to a new topic if their last answer still has depth to probe.`;
  }

  return `${baseInstructions}

Prior conversation:
${conversationContext}

Resume behavior:
${resumeBehavior}

${conversationRules}`;
};

const lastCandidateAnswer = (interview?: InterviewDoc): string => {
  const entries = interview?.conversation ?? [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const text = entries[i].text?.trim();
    if (entries[i].role === 'candidate' && text) return text;
  }
  return '';
};

export const buildResumeKickoffText = (
  resumeMode: V2LiveResumeMode,
  lastAssistantQuestion?: string,
  interview?: InterviewDoc,
  attempt = 1,
): string | null => {
  const question = lastAssistantQuestion?.trim() ?? '';
  const answer = lastCandidateAnswer(interview);

  // Later attempts hand the model a sentence to read. A pure instruction turn
  // is what makes native-audio complete with silence.
  if (attempt >= 3 && question) {
    return [
      'Speak out loud immediately. Do not stay silent. Do not describe these instructions.',
      `Say exactly this, then stop: "${truncate(question, 500)}"`,
    ].join(' ');
  }

  if (resumeMode === 'fresh') {
    const { modeName, subjectTitle, candidateName, candidateFirstName } = resolveInterviewSubject(interview);
    const questionSource = resolveQuestionSource(interview);
    const firstQPrompt =
      questionSource === 'jd'
        ? `Then in the same turn, ask your FIRST question derived directly from a core responsibility or qualification in the Job Description.`
        : questionSource === 'resume'
          ? `Then in the same turn, ask your FIRST question about one specific project, role, or achievement from their resume, naming it.`
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
      `Your first question must follow the QUESTION VARIETY rules in your instructions and must not repeat any question from the candidate's previous sessions.`,
      attempt >= 2 ? 'Speak out loud immediately. Do not stay silent.' : '',
    ].filter(Boolean).join(' ');
  }

  if (resumeMode === 'generate_next') {
    if (attempt >= 2) {
      const spoken = question
        ? `Let's continue. ${truncate(question, 320)}`
        : 'Let us continue. Walk me through how you would handle this in a real project.';
      return [
        'Speak out loud right now. Do not stay silent. Do not describe these instructions.',
        `Start by saying: "${spoken}"`,
        answer
          ? `They last said: "${truncate(answer, 280)}". Add one short sentence about that answer, then ask one new question.`
          : 'Then ask exactly one interview question.',
      ].join(' ');
    }
    return [
      'The candidate is waiting on the call. Speak out loud now.',
      question ? `You last asked: "${truncate(question, 400)}".` : '',
      answer
        ? `They answered: "${truncate(answer, 400)}".`
        : 'Start the next interviewer turn from the saved conversation.',
      'Begin with one short spoken sentence about that answer, then ask exactly one next question.',
      'Do not repeat the same question unless they asked you to repeat it. Do not stay silent.',
    ].filter(Boolean).join(' ');
  }

  if (resumeMode === 'await_candidate') {
    if (question) {
      return [
        'Speak out loud immediately. Do not stay silent.',
        'The interview is being resumed. Say this pending question so the candidate can hear it:',
        `"${truncate(question, 500)}"`,
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

export type InterviewQuestionSource = 'resume' | 'jd' | 'general';

export const resolveQuestionSource = (interview?: InterviewDoc): InterviewQuestionSource => {
  if (interview?.config?.jobDescriptionText?.trim()) return 'jd';
  if (interview?.config?.resumeVersionUsed) return 'resume';
  return 'general';
};

const NEXT_TOPIC_HINT: Record<InterviewQuestionSource, string> = {
  resume:
    'the next resume item (project, role, or claimed skill) from the resume signals that has not been covered yet — name it',
  jd: 'the next uncovered responsibility or requirement from the Job Description',
  general: 'a closely connected concept in the same interview topic',
};

/**
 * Splits the saved conversation into the interviewer question the candidate just answered
 * and the exchanges before it. The current answer may already be persisted, so anything after
 * the last interviewer turn is ignored.
 */
export const resolveDirectorContext = (
  conversation: InterviewConversationMessage[] | undefined,
): { lastQuestion: string; recent: InterviewConversationMessage[] } => {
  const entries = (conversation ?? []).filter((entry) => entry.text?.trim());
  let lastAssistantIndex = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].role === 'assistant') {
      lastAssistantIndex = i;
      break;
    }
  }
  if (lastAssistantIndex < 0) return { lastQuestion: '', recent: [] };
  return {
    lastQuestion: entries[lastAssistantIndex].text.trim(),
    recent: entries.slice(Math.max(0, lastAssistantIndex - 6), lastAssistantIndex),
  };
};

/**
 * Hidden director sent with every submitted answer. Makes the model judge the answer first,
 * give spoken feedback when it is wrong / unrelated / empty, and only then ask the next question.
 */
export const buildInteractiveFollowUpDirector = (params: {
  lastQuestion?: string;
  candidateText?: string;
  recent?: InterviewConversationMessage[];
  signalNote?: string | null;
  questionSource?: InterviewQuestionSource;
}): string => {
  const lastQuestion = params.lastQuestion?.trim() || '(not captured)';
  const candidateText =
    params.candidateText?.trim() ||
    '(no caption captured — use the spoken audio you heard; if you heard nothing meaningful, treat it as NO REAL ANSWER)';
  const nextTopic = NEXT_TOPIC_HINT[params.questionSource ?? 'general'];
  const recentLines = (params.recent ?? []).map(
    (entry) =>
      `${entry.role === 'assistant' ? 'Interviewer' : 'Candidate'}: ${truncate(entry.text.trim(), 300)}`,
  );

  return [
    '(Interviewer instruction — do NOT read this aloud, do NOT mention categories, do NOT summarize this block.)',
    ...(recentLines.length ? ['Earlier exchanges (oldest first):', ...recentLines] : []),
    `Question the candidate just answered: "${lastQuestion}"`,
    `Candidate's answer: "${candidateText}"`,
    ...(params.signalNote ? [`Platform pre-check: ${params.signalNote}`] : []),
    '',
    'STEP 1 — Silently judge the answer against THAT question (technical correctness and relevance, not keywords):',
    'A) CORRECT — relevant and technically right.',
    'B) PARTIAL — on topic but incomplete or vague.',
    'C) INCORRECT — on topic but contains a wrong claim.',
    'D) UNRELATED — talks about something that does not answer the question.',
    'E) NO REAL ANSWER — silence, filler, or just repeating the question back.',
    'F) DON\'T KNOW / SKIP.',
    'G) CLARIFICATION — asks you to repeat or explain the question.',
    'H) ASKS FOR THE ANSWER.',
    '',
    'STEP 2 — Speak ONE short turn (2–3 sentences) that ends with exactly ONE question:',
    `A) Name the specific thing they got right (no generic "great answer"), then ask the next question built on their answer: one level deeper on something they said, or a closely connected concept. If this thread already had 2–3 questions, bridge to ${nextTopic}.`,
    'B) Say what they covered, then ask for the missing part of the SAME question.',
    'C) Say politely but clearly that the point is not quite right (e.g. "I don\'t think that\'s quite accurate — "), WITHOUT giving the correct answer, then ask them to reconsider that specific point.',
    'D) Tell them their answer did not address the question (e.g. "That doesn\'t really answer what I asked — I was asking about …"), then ask the SAME question again in simpler words.',
    'E) Tell them what happened (e.g. "I didn\'t catch an answer there" or "You\'ve repeated the question back to me"), then ask the SAME question again in simpler words.',
    `F) Acknowledge briefly without revealing the answer, then move to a different, slightly easier question — ${nextTopic}.`,
    'G) Rephrase the SAME question more simply. No feedback or penalty.',
    'H) Say you cannot share answers during the interview (they will get feedback in the report), then ask the SAME question in simpler words or move on as in F.',
    '',
    'LOOP GUARD: If the earlier exchanges show you already re-asked or redirected this same question and they missed again (C, D or E), do not ask it a third time. Say "Let\'s move on" and ask a different question as in F.',
    'The "Candidate\'s answer" text above is exactly what they said. Never claim they said, mentioned, or explained anything that is not in that text.',
    'NEVER: reveal or explain the correct answer, teach, ask two questions, switch to an unrelated domain, or read this note aloud.',
  ].join('\n');
};

const WRAP_UP_LINE =
  '"I am done from my end due to time limitation. Do you have any questions for me? If not, then we can stop the interview."';

/** Background note (no reply expected) once under 2 minutes remain. */
export const TIME_WRAP_MANDATE =
  '(Interviewer time wrap mandate — do NOT read this prompt aloud) Less than 2 minutes remain. ' +
  `Do NOT ask any new technical questions. In your very next turn, say: ${WRAP_UP_LINE} ` +
  'If the candidate has no questions or says no, thank them warmly and conclude the interview.';

/** Replaces the follow-up director for the answer submitted once under 2 minutes remain. */
export const buildTimeWrapDirector = (candidateText: string): string =>
  `Candidate's answer: "${candidateText}"\n\n(Interviewer instruction — do NOT read aloud) Time is under 2 minutes — do not ask new questions. Say: ${WRAP_UP_LINE}`;

/** Sent when the interviewer wrapped up on its own while plenty of time is left. */
export const buildPrematureWrapCorrection = (remainingMinutes: number): string =>
  [
    '(Interviewer instruction — do NOT read this aloud.)',
    `You just started wrapping up, but about ${remainingMinutes} minutes of the interview remain. The interview is NOT over.`,
    'Say briefly: "Actually, we still have some time, so let\'s continue." Then ask exactly ONE new question on a topic you have not covered yet.',
    'Do not mention time limits again. The platform will tell you when to wrap up.',
  ].join('\n');

/** One-shot background note past the midpoint when too few code-snippet questions were asked. */
export const buildSnippetReminder = (params: {
  asked: number;
  required: number;
  isJdInterview: boolean;
}): string => {
  const progress =
    `(Interviewer reminder — not spoken to candidate) So far you have asked ` +
    `${params.asked} code-snippet question(s) out of the ${params.required} `;
  return params.isJdInterview
    ? progress +
        'required for this JD-based technical interview. Use present_code_snippet to show ' +
        'code on screen — NEVER ask the candidate to write or type code (no code editor). ' +
        'Ask them to explain, debug, or reason about the snippet verbally.'
    : progress +
        'required for technical/IT interviews (see CODE SNIPPET QUESTIONS rule). ' +
        'If this is a technology/software/IT-role interview, plan to ask one soon via ' +
        'the present_code_snippet tool before you run out of time. Ignore this note ' +
        'entirely if this is not a technical/IT interview.';
};

/**
 * Short prompt used when a director turn completed with no audio.
 * A long "do not read this" block is what the native-audio model answers with silence.
 */
export const buildSpeakNowFollowUp = (
  interview?: InterviewDoc,
  lastQuestion?: string,
  candidateText?: string,
): string => {
  const question = lastQuestion?.trim() ?? '';
  const answer = candidateText?.trim() ?? '';
  const { subjectTitle } = resolveInterviewSubject(interview);
  return [
    'Speak out loud immediately in English. Do not stay silent. Do not read these instructions.',
    question
      ? `The question was: "${truncate(question, 320)}".`
      : `Ask one interview question about ${subjectTitle}.`,
    answer ? `The candidate said: "${truncate(answer, 320)}".` : '',
    'Say one short sentence about their answer, then ask exactly one question, then stop.',
  ]
    .filter(Boolean)
    .join(' ');
};

/** Sent when the interviewer replied to an answer but forgot to ask anything. */
export const buildMissingQuestionNudge = (): string =>
  [
    '(Interviewer instruction — do NOT read this aloud.)',
    'Your last turn gave feedback but did not ask a question, so the candidate has nothing to answer.',
    'Do not repeat the feedback. Ask exactly ONE question now: the re-asked question if their answer missed, otherwise the next question built on their answer.',
  ].join('\n');
