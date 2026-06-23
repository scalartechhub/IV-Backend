import type { ResumeAnalysis, JDAnalysis, InterviewType } from "../interview.types";
import type { UserProfile } from "../../auth/auth.types";
import { getQuestionDistribution } from "../../../shared/constants";

interface QuestionGeneratorParams {
  technology: string;
  experienceLevel: string;
  interviewType: InterviewType;
  questionCount: number;
  resumeAnalysis?: ResumeAnalysis;
  jdAnalysis?: JDAnalysis;
  userProfile?: UserProfile;
}

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
  jdAnalysis?: JDAnalysis,
  userProfile?: UserProfile
): string => {
  if (jdAnalysis) {
    return `Job Requirements (from job description):
- Required Skills: ${jdAnalysis.requiredSkills.slice(0, 10).join(", ") || "Not specified"}
- Core Responsibilities: ${jdAnalysis.responsibilities.slice(0, 5).join(" | ") || "Not specified"}
- Experience Needed: ${jdAnalysis.experience.slice(0, 3).join(" | ") || "Not specified"}`;
  }

  if (userProfile) {
    const techStacks =
      userProfile.interviewPreferences?.favoriteTechStacks
        ?.map((t) => t.label)
        .filter(Boolean)
        .join(", ") || "Not specified";
    const difficulty =
      userProfile.interviewPreferences?.difficultyLevel ?? "Intermediate";
    const personality =
      userProfile.interviewPreferences?.aiPersonality ?? "Balanced";
    const targetRole = userProfile.professionalDetails?.designation ?? technology;
    const company = userProfile.professionalDetails?.company ?? "Not specified";

    return `Interview Focus (from user preferences & profile):
- Target Role: ${targetRole}
- Current Company: ${company}
- Preferred Tech Stacks: ${techStacks}
- Difficulty Level: ${difficulty}
- Interviewer Style: ${personality}
- Interview Type: ${interviewType}`;
  }

  return `Interview Focus:
- Target Technology/Role: ${technology}
- Interview Type: ${interviewType}`;
};

export const buildQuestionGeneratorPrompt = (params: QuestionGeneratorParams): string => {
  const {
    resumeAnalysis,
    jdAnalysis,
    userProfile,
    technology,
    experienceLevel,
    interviewType,
    questionCount,
  } = params;

  const distribution = getQuestionDistribution(questionCount);

  const candidateSection = buildCandidateSection(
    technology,
    experienceLevel,
    resumeAnalysis,
    userProfile
  );
  const requirementsSection = buildRequirementsSection(
    technology,
    interviewType,
    jdAnalysis,
    userProfile
  );

  const sourceNote =
    resumeAnalysis || jdAnalysis
      ? "Use resume/JD data where provided; supplement with user profile details."
      : "Base all questions on the candidate profile and interview preferences above.";

  return `
You are a senior technical interviewer conducting a ${interviewType} interview for a ${technology} position.
The candidate has ${experienceLevel} of experience.

${candidateSection}

${requirementsSection}

${sourceNote}

Generate EXACTLY ${distribution.total} interview questions:
- ${distribution.easy} EASY questions (foundational concepts, definitions, basic usage)
- ${distribution.medium} MEDIUM questions (practical application, problem-solving, real scenarios)
- ${distribution.hard} HARD questions (advanced architecture, optimisation, complex trade-offs)

Guidelines:
- Tailor questions to the candidate's skills, experience, and preferred tech stacks
- Match difficulty to the user's stated difficulty level when available
- Include a mix of theoretical and practical questions appropriate for the interview type (${interviewType})
- Each question should be specific and answerable in 2-5 minutes verbally
- Assign a relevant category (e.g. "React", "System Design", "JavaScript", "CSS", "Testing")

Return ONLY a valid JSON array. No markdown, no explanation:
[
  {
    "question": "What is the difference between null and undefined in JavaScript?",
    "difficulty": "easy",
    "category": "JavaScript"
  }
]
`.trim();
};
