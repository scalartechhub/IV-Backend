import type { ResumeAnalysis, JDAnalysis } from "../interview.types";
import { QUESTION_DISTRIBUTION } from "../../../shared/constants";

interface QuestionGeneratorParams {
  resumeAnalysis: ResumeAnalysis;
  jdAnalysis: JDAnalysis;
  role: string;
  experience: string;
}

export const buildQuestionGeneratorPrompt = (params: QuestionGeneratorParams): string => {
  const { resumeAnalysis, jdAnalysis, role, experience } = params;

  return `
You are a senior technical interviewer conducting an interview for a ${role} position.
The candidate has ${experience} of experience.

Candidate Profile (from resume):
- Technical Skills: ${resumeAnalysis.skills.slice(0, 15).join(", ")}
- Experience: ${resumeAnalysis.experience.slice(0, 3).join(" | ")}
- Key Projects: ${resumeAnalysis.projects.slice(0, 3).join(" | ")}

Job Requirements:
- Required Skills: ${jdAnalysis.requiredSkills.slice(0, 10).join(", ")}
- Core Responsibilities: ${jdAnalysis.responsibilities.slice(0, 5).join(" | ")}
- Experience Needed: ${jdAnalysis.experience.slice(0, 3).join(" | ")}

Generate EXACTLY ${QUESTION_DISTRIBUTION.TOTAL} interview questions:
- ${QUESTION_DISTRIBUTION.EASY} EASY questions (foundational concepts, definitions, basic usage)
- ${QUESTION_DISTRIBUTION.MEDIUM} MEDIUM questions (practical application, problem-solving, real scenarios)
- ${QUESTION_DISTRIBUTION.HARD} HARD questions (advanced architecture, optimisation, complex trade-offs)

Guidelines:
- Tailor questions to overlap between the candidate's skills and the job requirements
- Include a mix of theoretical and practical questions
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
