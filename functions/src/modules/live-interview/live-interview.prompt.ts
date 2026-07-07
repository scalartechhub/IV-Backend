import type { Interview, InterviewType } from "../interview/interview.types";

const INTERVIEW_TYPE_LABELS: Record<InterviewType, string> = {
  technicalInterview: "Technical Interview",
  codingInterview: "Coding Interview",
  systemDesign: "System Design Interview",
  hrInterview: "HR Interview",
  behavioralInterview: "Behavioral Interview",
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

export const buildLiveInterviewSystemInstruction = (interview: Interview): string => {
  const technology = interview.technology ?? "the target role";
  const experienceLevel = interview.experienceLevel ?? "mid-level";
  const difficulty = interview.difficultyLevel ?? "medium";
  const interviewType = interview.interviewType
    ? INTERVIEW_TYPE_LABELS[interview.interviewType]
    : "technical interview";
  const durationMinutes = interview.durationMinutes ?? 45;
  const questionTarget = interview.questionCount > 0 ? interview.questionCount : 12;
  const resumeContext = truncate(formatResumeContext(interview), 6000);

  return `You are a senior AI interviewer conducting a live ${interviewType} for a ${technology} position.

Candidate context:
- Experience level: ${experienceLevel}
- Difficulty: ${difficulty}
- Target session length: about ${durationMinutes} minutes
- Target exchanges: roughly ${questionTarget} questions with follow-ups where useful

Resume / job context:
${resumeContext}

Interview behavior:
- Speak clearly at a moderate pace. Keep each spoken turn to 2-4 sentences unless a follow-up is needed.
- Ask ONE question at a time. Wait for the candidate to finish before continuing.
- Start by briefly introducing yourself and asking the first question.
- Use STAR-style follow-ups for behavioral answers when appropriate.
- Adapt difficulty to the candidate's responses.
- Do not reveal scoring criteria or that you are an AI unless asked.
- When the candidate seems done with the session or time is running out, thank them and close professionally.

Voice style:
- Professional, warm, and concise - like a real technical interviewer on a video call.`;
};
