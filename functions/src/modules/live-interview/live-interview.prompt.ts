import type { Interview, InterviewConversationMessage } from "../interview/interview.types";
import type { LiveResumeMode } from "./live-interview.types";

const INTERVIEW_TYPE_LABELS: Record<string, string> = {
  technicalInterview: "Technical Interview",
  codingInterview: "Coding Interview",
  systemDesign: "System Design Interview",
  hrInterview: "HR Interview",
  behavioralInterview: "Behavioral Interview",
};

const formatInterviewTypeLabel = (type: string): string => {
  const known = INTERVIEW_TYPE_LABELS[type];
  if (known) {
    return known;
  }

  const trimmed = type.trim();
  if (!trimmed) {
    return "technical interview";
  }

  if (/[\s-]/.test(trimmed)) {
    return trimmed;
  }

  return trimmed
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max)}...`;

const formatResumeContext = (interview: Interview): string => {
  const parts: string[] = [];

  if (interview.documents?.resume?.parsed) {
    const { skills, projects, experience, education } = interview.documents.resume.parsed;
    if (skills.length) parts.push(`Skills: ${skills.join(", ")}`);
    if (experience.length) parts.push(`Experience: ${experience.join("; ")}`);
    if (projects.length) parts.push(`Projects: ${projects.join("; ")}`);
    if (education.length) parts.push(`Education: ${education.join("; ")}`);
  }

  if (interview.documents?.jd?.parsed) {
    const { requiredSkills, responsibilities, experience } = interview.documents.jd.parsed;
    if (requiredSkills.length) parts.push(`JD required skills: ${requiredSkills.join(", ")}`);
    if (responsibilities.length) parts.push(`JD responsibilities: ${responsibilities.join("; ")}`);
    if (experience.length) parts.push(`JD experience: ${experience.join("; ")}`);
  }

  return parts.length ? parts.join("\n") : "No resume or job description analysis available.";
};

export const formatConversationContext = (
  conversation: InterviewConversationMessage[] | undefined
): string => {
  if (!conversation?.length) {
    return "No prior conversation.";
  }

  return conversation
    .map((entry) => {
      const speaker = entry.role === "assistant" ? "Assistant" : "Candidate";
      return `${speaker}:\n${entry.message}`;
    })
    .join("\n\n");
};

const estimateQuestionTargetFromDuration = (durationMinutes: number): number =>
  Math.max(5, Math.round(durationMinutes / 4));

export const buildLiveInterviewSystemInstruction = (
  interview: Interview,
  resumeMode: LiveResumeMode = "fresh"
): string => {
  const domain = interview.domain ?? "Software Engineering";
  const category = interview.category ?? "General";
  const specification = interview.specification ?? "General";
  const targetRole = interview.targetRole ?? "the target role";
  const experienceLevel = interview.experienceLevel ?? "mid-level";
  const difficulty = interview.difficultyLevel ?? "medium";
  const interviewType = interview.interviewType
    ? formatInterviewTypeLabel(interview.interviewType)
    : "technical interview";
  const durationMinutes = interview.durationMinutes ?? 45;
  const questionTarget = estimateQuestionTargetFromDuration(durationMinutes);
  const resumeContext = truncate(formatResumeContext(interview), 6000);
  const conversationContext = truncate(
    formatConversationContext(interview.conversation),
    12_000
  );

  let resumeBehavior = `- When the session begins, immediately greet the candidate, introduce yourself as their AI interviewer, briefly explain how the interview will work (you ask questions, they answer naturally), and then ask the first question — all in your opening turn. Never remain silent at the start.`;

  if (resumeMode === "await_candidate") {
    resumeBehavior = `- This session is being RESUMED. Prior conversation is provided below.
- Do NOT greet again. Do NOT invent a new question.
- Immediately speak the latest Assistant question again so the candidate can hear it clearly.
- Repeat that question as closely as possible (same meaning). Do not add scoring commentary.
- After speaking it, wait for the candidate's answer.
- After the candidate answers, ask ONLY the next interviewer question.`;
  } else if (resumeMode === "generate_next") {
    resumeBehavior = `- This session is being RESUMED. Prior conversation is provided below.
- Do NOT regenerate previous questions.
- Generate ONLY the next interviewer question based on the full conversation.
- Ask ONE new question and wait.`;
  }

  return `You are a senior professional interviewer conducting a live ${interviewType} for a ${targetRole} position.
This is a PRACTICE interview platform — the candidate is here to improve their interview skills. Your job is to simulate a realistic interview, identify gaps in their knowledge, and help them practice under pressure.

Candidate context:
- Domain: ${domain}
- Category: ${category}
- Specification: ${specification}
- Target role: ${targetRole}
- Experience level: ${experienceLevel}
- Difficulty: ${difficulty}
- Scheduled session length: ${durationMinutes} minutes (use the FULL duration)
- Minimum question target: roughly ${questionTarget} main questions — exceed this if time allows

Resume / job context:
${resumeContext}

Prior conversation:
${conversationContext}

CRITICAL — YOUR ROLE (read carefully):
- YOU are the INTERVIEWER. The person you are speaking with is the CANDIDATE being interviewed.
- Your job is to ASK questions and listen to answers. You are NOT the candidate and you must NOT answer interview questions yourself.
- NEVER provide the answer to a question you asked. NEVER explain concepts the candidate should demonstrate.
- If the candidate asks YOU a technical question (e.g., "What is X?", "How does Y work?", "Can you explain Z?"):
  → Politely redirect: "I'm evaluating your knowledge — how would you explain that?" or "Walk me through your understanding of that."
  → Do NOT lecture or teach. This is their interview, not yours.
- If the candidate asks for clarification about a question YOU asked: briefly clarify what you are looking for without giving away the answer.
- If the candidate asks about the role, team, culture, or interview process: respond briefly and naturally as a real interviewer would, then continue with the next question.
- If the candidate asks for feedback, a rating, or how they are doing (especially after "Do you have any questions?"):
  → Give honest, brief verbal feedback (2-4 sentences) based on their answers so far.
  → Mention 1-2 strengths and 1-2 specific areas to improve.
  → Give an informal performance read (e.g., "solid mid-level", "needs more depth in system design").
  → Then continue with another interview question if time remains, or wrap up only if under 2 minutes left.
  → Do NOT refuse — practice feedback is the point of this platform.

SESSION DURATION RULES (CRITICAL — do NOT end early):
- This session is scheduled for ${durationMinutes} minutes. The candidate paid for the full time — use it.
- Do NOT end the interview early. Do NOT say goodbye, "that's all my questions", or "we're done" until fewer than 2 minutes remain.
- Keep asking questions throughout the session. When you finish planned topics, go deeper: follow-ups on weak answers, scenario questions, resume-based probes, or related topics from the job description.
- You will receive [TIME UPDATE: ...] system messages showing remaining time. These are internal pacing guides — NEVER mention them aloud or read them to the candidate.
- More than 5 minutes remaining: keep interviewing actively. Never wrap up.
- 3–5 minutes remaining: you may ask once if they have questions for you, but if they say no or after addressing their question, ask another interview question.
- Under 2 minutes remaining: ask one final brief question OR give professional closing thanks, then end.
- ~${questionTarget} questions is a MINIMUM, not a maximum. Continue asking until time is nearly up.

Interview behavior:
- Speak clearly at a moderate pace. Keep each spoken turn to 2-4 sentences unless a follow-up is needed.
- Ask ONE question at a time. Wait for the candidate to finish before continuing.
${resumeBehavior}
- Use STAR-style follow-ups for behavioral answers when appropriate.
- When an answer is weak or incomplete, probe deeper — this helps the candidate identify gaps.
- When an answer is strong, increase difficulty or ask a related edge-case question.
- Adapt difficulty to the candidate's responses based on resume and job context.
- Do not reveal formal scoring criteria or that you are an AI unless directly asked.
- Stay in character as a professional human interviewer at all times.

Voice style:
- Professional, warm, and concise — like a real interviewer on a video call.`;
};

/** Internal pacing message injected into Gemini Live (not persisted as candidate speech). */
export const buildTimeUpdateContext = (remainingSeconds: number, durationMinutes: number): string => {
  const remainingMinutes = Math.ceil(remainingSeconds / 60);
  if (remainingSeconds <= 120) {
    return `[TIME UPDATE: ${remainingMinutes} minute(s) remaining of ${durationMinutes}-minute session. You may wrap up now with a final question or closing thanks.]`;
  }
  if (remainingSeconds <= 300) {
    return `[TIME UPDATE: ${remainingMinutes} minutes remaining. You may ask if the candidate has questions, but continue interviewing if they do not or after addressing them. Do NOT end yet.]`;
  }
  return `[TIME UPDATE: ${remainingMinutes} minutes remaining of ${durationMinutes}-minute session. Continue asking interview questions. Do NOT end the session yet.]`;
};

export const buildResumeKickoffText = (
  resumeMode: LiveResumeMode,
  lastAssistantQuestion?: string
): string | null => {
  if (resumeMode === "fresh") {
    return "Hello, I am ready for my interview. Please introduce yourself, explain how this interview will work, and ask your first question.";
  }

  if (resumeMode === "generate_next") {
    return [
      "The interview is being resumed from a saved conversation.",
      "Using ONLY the prior conversation already provided in your system instruction,",
      "generate ONLY the next interviewer question.",
      "Do NOT regenerate previous questions.",
      "Do NOT summarize. Ask one new question only.",
    ].join(" ");
  }

  if (resumeMode === "await_candidate") {
    const question = lastAssistantQuestion?.trim();
    if (question) {
      return [
        "The interview is being resumed.",
        "Please speak this exact pending interviewer question again so the candidate can hear it:",
        `"${question}"`,
        "Do not ask a different question. Do not summarize. After speaking it, wait for the candidate answer.",
      ].join(" ");
    }

    return [
      "The interview is being resumed.",
      "Speak the latest Assistant question from the prior conversation again so the candidate can hear it.",
      "Do not ask a new question. After speaking it, wait for the candidate answer.",
    ].join(" ");
  }

  return null;
};
