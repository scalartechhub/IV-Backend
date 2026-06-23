import type {
  ResumeAnalysis,
  JDAnalysis,
  InterviewType,
  DifficultyLevel,
} from "../interview.types";
import type { UserProfile } from "../../auth/auth.types";
import { toQuestionDifficulty } from "../interview.types";

interface QuestionGeneratorParams {
  technology: string;
  experienceLevel: string;
  difficultyLevel: DifficultyLevel;
  interviewType: InterviewType;
  questionCount: number;
  resumeAnalysis?: ResumeAnalysis;
  jdAnalysis?: JDAnalysis;
  userProfile?: UserProfile;
}

const getInterviewTypeGuidance = (interviewType: InterviewType): string => {
  switch (interviewType) {
    case "Technical Interview":
      return "Focus on core technical knowledge, frameworks, tools, debugging, and role-specific concepts.";
    case "Coding Interview":
      return "Focus on algorithms, data structures, problem decomposition, complexity analysis, and verbal walkthroughs of code solutions.";
    case "System Design":
      return "Focus on architecture, scalability, reliability, trade-offs, APIs, databases, caching, and distributed systems.";
    case "HR Interview":
      return "Focus on career goals, role fit, communication, motivation, expectations, and professional background.";
    case "Behavioral Interview":
      return "Focus on past experiences using STAR-style prompts, teamwork, conflict resolution, ownership, and soft skills.";
    default:
      return "Tailor questions to the stated interview type and candidate background.";
  }
};

const buildCandidateSection = (
  technology: string,
  experienceLevel: string,
  resumeAnalysis?: ResumeAnalysis,
  userProfile?: UserProfile
): string => {
  if (resumeAnalysis) {
    return `Candidate Profile (from resume):
- Technical Skills: ${resumeAnalysis.skills.slice(0, 15).join(", ") || "Not specified"}
- Experience: ${resumeAnalysis.experience.slice(0, 3).join(" | ") || "Not specified"}
- Key Projects: ${resumeAnalysis.projects.slice(0, 3).join(" | ") || "Not specified"}
- Education: ${resumeAnalysis.education.slice(0, 3).join(" | ") || "Not specified"}`;
  }

  if (userProfile) {
    const skills =
      userProfile.skills?.map((s) => s.name).filter(Boolean).slice(0, 15).join(", ") ||
      "Not specified";
    const workHistory =
      userProfile.experiences
        ?.slice(0, 5)
        .map(
          (e) =>
            `${e.title} at ${e.company}${e.period ? ` (${e.period})` : ""}${e.description ? `: ${e.description}` : ""}`
        )
        .join(" | ") || "Not specified";
    const designation = userProfile.professionalDetails?.designation ?? technology;
    const years =
      userProfile.professionalDetails?.yearsOfExperience ?? experienceLevel;
    const industry = userProfile.professionalDetails?.industry ?? "Not specified";
    const bio = userProfile.professionalSummary?.bio ?? "Not specified";

    return `Candidate Profile (from user profile):
- Name: ${userProfile.name ?? "Not specified"}
- Current Designation: ${designation}
- Years of Experience: ${years}
- Industry: ${industry}
- Technical Skills: ${skills}
- Work History: ${workHistory}
- Professional Summary: ${bio}`;
  }

  return `Candidate Profile:
- Target Technology/Role: ${technology}
- Experience Level: ${experienceLevel}`;
};

const buildRequirementsSection = (
  technology: string,
  interviewType: InterviewType,
  difficultyLevel: DifficultyLevel,
  jdAnalysis?: JDAnalysis,
  userProfile?: UserProfile
): string => {
  if (jdAnalysis) {
    return `Job Requirements (from job description):
- Required Skills: ${jdAnalysis.requiredSkills.slice(0, 10).join(", ") || "Not specified"}
- Core Responsibilities: ${jdAnalysis.responsibilities.slice(0, 5).join(" | ") || "Not specified"}
- Experience Needed: ${jdAnalysis.experience.slice(0, 3).join(" | ") || "Not specified"}
- Interview Type: ${interviewType}
- Difficulty Level: ${difficultyLevel}`;
  }

  if (userProfile) {
    const techStacks =
      userProfile.interviewPreferences?.favoriteTechStacks
        ?.map((t) => t.label)
        .filter(Boolean)
        .join(", ") || "Not specified";
    const personality =
      userProfile.interviewPreferences?.aiPersonality ?? "Balanced";
    const targetRole = userProfile.professionalDetails?.designation ?? technology;
    const company = userProfile.professionalDetails?.company ?? "Not specified";

    return `Interview Focus (from user preferences & profile):
- Target Role: ${targetRole}
- Current Company: ${company}
- Preferred Tech Stacks: ${techStacks}
- Interviewer Style: ${personality}
- Interview Type: ${interviewType}
- Difficulty Level: ${difficultyLevel}`;
  }

  return `Interview Focus:
- Target Technology/Role: ${technology}
- Interview Type: ${interviewType}
- Difficulty Level: ${difficultyLevel}`;
};

export const buildQuestionGeneratorPrompt = (params: QuestionGeneratorParams): string => {
  const {
    resumeAnalysis,
    jdAnalysis,
    userProfile,
    technology,
    experienceLevel,
    difficultyLevel,
    interviewType,
    questionCount,
  } = params;

  const questionDifficulty = toQuestionDifficulty(difficultyLevel);
  const interviewTypeGuidance = getInterviewTypeGuidance(interviewType);

  const candidateSection = buildCandidateSection(
    technology,
    experienceLevel,
    resumeAnalysis,
    userProfile
  );
  const requirementsSection = buildRequirementsSection(
    technology,
    interviewType,
    difficultyLevel,
    jdAnalysis,
    userProfile
  );

  const sourceNote =
    resumeAnalysis || jdAnalysis
      ? "Use resume/JD data where provided; supplement with user profile details."
      : "Base all questions on the candidate profile and interview preferences above.";

  return `
You are a senior interviewer conducting a ${interviewType} for a ${technology} position.
The candidate has ${experienceLevel} of experience.

${candidateSection}

${requirementsSection}

Interview type guidance:
- ${interviewTypeGuidance}

${sourceNote}

Generate EXACTLY ${questionCount} interview questions.
Every question MUST be at the ${difficultyLevel} difficulty level.
Set the "difficulty" field to "${questionDifficulty}" for every question.

Guidelines:
- Tailor questions to the candidate's skills, experience, and preferred tech stacks
- All questions must fit the selected interview type (${interviewType})
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
