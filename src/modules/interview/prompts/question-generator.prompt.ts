import type {
  ResumeAnalysis,
  JDAnalysis,
  InterviewType,
  DifficultyLevel,
} from "../interview.types";
import { toQuestionDifficulty } from "../interview.types";

interface QuestionGeneratorParams {
  technology?: string;
  experienceLevel?: string;
  difficultyLevel: DifficultyLevel;
  interviewType: InterviewType;
  questionCount: number;
  resumeAnalysis?: ResumeAnalysis;
  jdAnalysis?: JDAnalysis;
  documentsOnly?: boolean;
}

const INTERVIEW_TYPE_LABELS: Record<InterviewType, string> = {
  technicalInterview: "Technical Interview",
  codingInterview: "Coding Interview",
  systemDesign: "System Design",
  hrInterview: "HR Interview",
  behavioralInterview: "Behavioral Interview",
};

const getInterviewTypeLabel = (interviewType: InterviewType): string =>
  INTERVIEW_TYPE_LABELS[interviewType];

const getInterviewTypeGuidance = (interviewType: InterviewType): string => {
  switch (interviewType) {
    case "technicalInterview":
      return "Focus on core technical knowledge, frameworks, tools, debugging, and role-specific concepts.";
    case "codingInterview":
      return "Focus on algorithms, data structures, problem decomposition, complexity analysis, and verbal walkthroughs of code solutions.";
    case "systemDesign":
      return "Focus on architecture, scalability, reliability, trade-offs, APIs, databases, caching, and distributed systems.";
    case "hrInterview":
      return "Focus on career goals, role fit, communication, motivation, expectations, and professional background.";
    case "behavioralInterview":
      return "Focus on past experiences using STAR-style prompts, teamwork, conflict resolution, ownership, and soft skills.";
    default:
      return "Tailor questions to the stated interview type and candidate background.";
  }
};

const buildCandidateSection = (
  documentsOnly: boolean,
  resumeAnalysis?: ResumeAnalysis,
  technology?: string,
  experienceLevel?: string
): string => {
  if (documentsOnly && resumeAnalysis) {
    return `Candidate Profile (from resume):
- Technical Skills: ${resumeAnalysis.skills.slice(0, 15).join(", ") || "Not specified"}
- Experience: ${resumeAnalysis.experience.slice(0, 3).join(" | ") || "Not specified"}
- Key Projects: ${resumeAnalysis.projects.slice(0, 3).join(" | ") || "Not specified"}
- Education: ${resumeAnalysis.education.slice(0, 3).join(" | ") || "Not specified"}`;
  }

  return `Candidate Profile (from interview setup):
- Target Technology/Role: ${technology ?? "Not specified"}
- Experience Level: ${experienceLevel ?? "Not specified"}`;
};

const buildRequirementsSection = (
  interviewType: InterviewType,
  difficultyLevel: DifficultyLevel,
  documentsOnly: boolean,
  jdAnalysis?: JDAnalysis,
  resumeAnalysis?: ResumeAnalysis,
  technology?: string
): string => {
  const interviewTypeLabel = getInterviewTypeLabel(interviewType);

  if (documentsOnly && jdAnalysis) {
    return `Job Requirements (from job description):
- Required Skills: ${jdAnalysis.requiredSkills.slice(0, 10).join(", ") || "Not specified"}
- Core Responsibilities: ${jdAnalysis.responsibilities.slice(0, 5).join(" | ") || "Not specified"}
- Experience Needed: ${jdAnalysis.experience.slice(0, 3).join(" | ") || "Not specified"}
- Interview Type: ${interviewTypeLabel}
- Difficulty Level: ${difficultyLevel}`;
  }

  if (documentsOnly && resumeAnalysis) {
    return `Role Context (from resume):
- Relevant Skills: ${resumeAnalysis.skills.slice(0, 10).join(", ") || "Not specified"}
- Experience Highlights: ${resumeAnalysis.experience.slice(0, 3).join(" | ") || "Not specified"}
- Interview Type: ${interviewTypeLabel}
- Difficulty Level: ${difficultyLevel}`;
  }

  return `Interview Focus (from interview setup):
- Target Technology/Role: ${technology ?? "Not specified"}
- Interview Type: ${interviewTypeLabel}
- Difficulty Level: ${difficultyLevel}`;
};

export const buildQuestionGeneratorPrompt = (params: QuestionGeneratorParams): string => {
  const {
    resumeAnalysis,
    jdAnalysis,
    technology,
    experienceLevel,
    difficultyLevel,
    interviewType,
    questionCount,
    documentsOnly = false,
  } = params;

  const questionDifficulty = toQuestionDifficulty(difficultyLevel);
  const interviewTypeLabel = getInterviewTypeLabel(interviewType);
  const interviewTypeGuidance = getInterviewTypeGuidance(interviewType);

  const candidateSection = buildCandidateSection(
    documentsOnly,
    resumeAnalysis,
    technology,
    experienceLevel
  );
  const requirementsSection = buildRequirementsSection(
    interviewType,
    difficultyLevel,
    documentsOnly,
    jdAnalysis,
    resumeAnalysis,
    technology
  );

  const sourceNote = documentsOnly
    ? "Base all questions only on the interview settings above and the uploaded resume and/or job description analysis. Do not assume any other candidate details."
    : "Base all questions only on the interview setup fields above (technology, experience level, interview type, and difficulty). Do not assume resume, job description, or profile data.";

  const interviewIntro = documentsOnly
    ? `You are a senior interviewer conducting a ${interviewTypeLabel} based on the uploaded resume and/or job description and the configured interview settings.`
    : `You are a senior interviewer conducting a ${interviewTypeLabel} for a ${technology} position.
The candidate has ${experienceLevel} of experience.`;

  const tailoringGuideline = documentsOnly
    ? "- Tailor questions to the resume and/or job description content and the configured interview settings"
    : "- Tailor questions to the technology, experience level, and interview settings provided above";

  return `
${interviewIntro}

${candidateSection}

${requirementsSection}

Interview type guidance:
- ${interviewTypeGuidance}

${sourceNote}

Generate EXACTLY ${questionCount} interview questions.
Every question MUST be at the ${difficultyLevel} difficulty level.
Set the "difficulty" field to "${questionDifficulty}" for every question.

Guidelines:
${tailoringGuideline}
- All questions must fit the selected interview type (${interviewTypeLabel})
- Do not mix easier or harder questions — keep all at ${difficultyLevel} level
- For Coding Interview: include algorithmic and implementation-style questions
- For System Design: include scalability, component design, and trade-off questions
- For HR / Behavioral Interview: avoid deep coding puzzles; focus on communication and experience
- Each question should be specific and answerable in 2-5 minutes verbally
- Assign a relevant category (e.g. "React", "System Design", "JavaScript", "Behavioral", "Algorithms")

Return ONLY a valid JSON array. No markdown, no explanation:
[
  {
    "question": "What is the difference between null and undefined in JavaScript?",
    "difficulty": "${questionDifficulty}",
    "category": "JavaScript"
  }
]
`.trim();
};
