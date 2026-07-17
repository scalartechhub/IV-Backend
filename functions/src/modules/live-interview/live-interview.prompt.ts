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
  const questionTarget = interview.questionCount > 0 ? interview.questionCount : 12;
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

  return `You are a senior AI interviewer conducting a live ${interviewType} for a ${targetRole} position.

Candidate context:
- Domain: ${domain}
- Category: ${category}
- Specification: ${specification}
- Target role: ${targetRole}
- Experience level: ${experienceLevel}
- Difficulty: ${difficulty}
- Target session length: about ${durationMinutes} minutes
- Target exchanges: roughly ${questionTarget} questions with follow-ups where useful

Resume / job context:
${resumeContext}

Prior conversation:
${conversationContext}

Interview behavior:
- Speak clearly at a moderate pace. Keep each spoken turn to 2-4 sentences unless a follow-up is needed.
- Ask ONE question at a time. Wait for the candidate to finish before continuing.
${resumeBehavior}
- Use STAR-style follow-ups for behavioral answers when appropriate.
- Adapt difficulty to the candidate's responses.
- Do not reveal scoring criteria or that you are an AI unless asked.
- When the candidate seems done with the session or time is running out, thank them and close professionally.

Voice style:
- Professional, warm, and concise - like a real technical interviewer on a video call.`;
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
