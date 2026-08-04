import type {
  InterviewConfig,
  InterviewMode,
} from '../interfaces/interview.interface';
import type { ResumeDoc } from '../interfaces/resume.interface';

const RESUME_TEXT_CHARS = 3_000;
const LIST_LIMIT = 12;

const MODE_LABELS: Record<InterviewMode, string> = {
  conversational: 'Technical Interview',
  coding: 'Coding Interview',
  behavioral: 'Behavioral Interview',
  system_design: 'System Design Interview',
  hr: 'HR Interview',
};

const MODE_FOCUS: Record<InterviewMode, string> = {
  conversational:
    'Focus on technical depth, concepts, and applied problem-solving for the chosen technology or domain.',
  coding:
    'Focus on coding problems, algorithms, data structures, and clear verbal walkthroughs of solutions.',
  behavioral:
    'Focus on STAR-style behavioral questions: teamwork, conflict, ownership, leadership, and past impact.',
  system_design:
    'Focus on architecture, scalability, reliability, trade-offs, and verbally describing system designs.',
  hr:
    'Focus on HR screening: motivation, culture fit, communication, career goals, availability, and professional soft skills. Avoid deep coding or system design.',
};

export function interviewModeLabel(mode: InterviewMode): string {
  return MODE_LABELS[mode] ?? 'Interview';
}

export function primaryTechnology(config: Pick<InterviewConfig, 'technologies' | 'skills'>): string {
  return config.technologies?.[0]?.trim() || config.skills?.[0]?.trim() || 'General';
}

export function buildInterviewHeaderLabel(
  mode: InterviewMode,
  config: Pick<InterviewConfig, 'technologies' | 'skills'>,
): string {
  return `${primaryTechnology(config)} · ${interviewModeLabel(mode)}`;
}

function takeStrings(items: string[] | undefined, max = LIST_LIMIT): string {
  return (items ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max)
    .join(', ');
}

/**
 * Builds AI-facing resume context from users/{uid}/onboarding/analysis when the
 * candidate opted in on Setup.
 */
export function buildResumeContextFromAnalysis(resume: ResumeDoc): string {
  const analysis = resume.analysis;
  if (!analysis) return '';

  const onboarding = analysis.onboarding;
  const sections: string[] = [];

  const targetRole = resume.targetRole?.trim();
  if (targetRole) {
    sections.push(`Target role (resume): ${targetRole}`);
  }

  const jobRole = onboarding?.jobRoleRecommendation?.trim();
  if (jobRole) {
    sections.push(`Recommended role: ${jobRole}`);
  }

  const experience = onboarding?.experienceLevelPrediction?.trim();
  if (experience) {
    sections.push(`Experience level: ${experience}`);
  }

  const summary = onboarding?.resumeStrengthSummary?.trim();
  if (summary) {
    sections.push(`Profile summary: ${summary}`);
  }

  const keywords = takeStrings(analysis.extractedKeywords);
  if (keywords) {
    sections.push(`Resume keywords: ${keywords}`);
  }

  const skills = takeStrings(analysis.recommendedSkills);
  if (skills) {
    sections.push(`Demonstrated / recommended skills: ${skills}`);
  }

  const missing = takeStrings(analysis.missingKeywords, 8);
  if (missing) {
    sections.push(`Skill gaps to probe: ${missing}`);
  }

  const strengths = (analysis.workingWell ?? [])
    .slice(0, 5)
    .map((item) => item.text.trim())
    .filter(Boolean);
  if (strengths.length) {
    sections.push(`Strengths to validate: ${strengths.join('; ')}`);
  }

  const highGaps = (onboarding?.skillGapAnalysis ?? [])
    .filter((gap) => gap.priority === 'High')
    .slice(0, 6)
    .map(
      (gap) =>
        `${gap.name} (${gap.currentLevel} → ${gap.targetLevel}): ${gap.reason}`,
    );
  if (highGaps.length) {
    sections.push(`Priority skill gaps:\n- ${highGaps.join('\n- ')}`);
  }

  const prepFocus = (onboarding?.interviewPreparation ?? [])
    .slice(0, 4)
    .map(
      (item) =>
        `${item.category} (${item.priority}): ${item.recommendation}`,
    );
  if (prepFocus.length) {
    sections.push(`Interview prep focus:\n- ${prepFocus.join('\n- ')}`);
  }

  const priorityAreas = takeStrings(onboarding?.priorityPreparationAreas, 6);
  if (priorityAreas) {
    sections.push(`Priority preparation areas: ${priorityAreas}`);
  }

  const tracks = takeStrings(onboarding?.recommendedInterviewTracks, 6);
  if (tracks) {
    sections.push(`Recommended interview tracks: ${tracks}`);
  }

  const excerpt = analysis.extractedText?.trim();
  if (excerpt) {
    sections.push(
      `Resume excerpt (ground questions in real experience):\n${excerpt.slice(0, RESUME_TEXT_CHARS)}`,
    );
  }

  return sections.join('\n\n');
}

export function buildInterviewSystemInstructions(
  mode: InterviewMode,
  config: InterviewConfig,
  opts: {
    resumeContext?: string;
    previousWeaknesses?: string[];
    topicProfile?: { strong: string[]; weak: string[] };
  } = {},
): string {
  const interviewType = interviewModeLabel(mode);
  const technology = primaryTechnology(config);
  const difficulty =
    config.difficulty.charAt(0).toUpperCase() + config.difficulty.slice(1);

  const companyName = config.company?.trim();
  const coreConfig = [
    `You are an expert interviewer conducting a ${interviewType}.`,
    `Interview type: ${interviewType}.`,
    MODE_FOCUS[mode],
    `Primary technology / focus: ${technology}.`,
    `Difficulty level: ${difficulty}.`,
    `Session duration: ${config.durationMinutes} minutes — pace questions accordingly.`,
    config.skills.length
      ? `Focus skills: ${config.skills.join(', ')}.`
      : '',
    config.technologies.length
      ? `Technologies to emphasize: ${config.technologies.join(', ')}.`
      : '',
    config.topic ? `Topic: ${config.topic}.` : '',
    companyName
      ? [
          `Target company: ${companyName}.`,
          `This is a ${companyName}-style interview. Ask questions that ${companyName} is known to ask for this role/type when possible.`,
          `Reflect ${companyName}'s interview culture, common rounds, and expectations (without inventing confidential/internal processes).`,
          `Prefer scenarios, follow-ups, and evaluation criteria that would realistically appear in a ${companyName} hiring process.`,
        ].join(' ')
      : '',
  ];

  const questioningStrategy = opts.resumeContext
    ? [
        'The candidate opted in to resume-based questioning.',
        'Use the resume signals below to tailor questions to their real projects, employers, skills, and gaps.',
        'Reference specific experiences when possible and validate claimed skills with concrete follow-ups.',
        `Resume signals:\n${opts.resumeContext}`,
      ]
    : [
        'Resume context was NOT provided for this session.',
        'Generate questions using ONLY the interview type, technology, difficulty, and duration above.',
        'Do not assume specific employers, projects, degrees, or resume details.',
      ];

  return [
    ...coreConfig,
    ...questioningStrategy,
    opts.previousWeaknesses?.length
      ? `Bias follow-ups toward prior weaknesses: ${opts.previousWeaknesses.slice(0, 9).join('; ')}`
      : '',
    opts.topicProfile?.strong.length
      ? `Candidate has already demonstrated mastery of these topics in past interviews — do NOT repeat them: ${opts.topicProfile.strong.slice(0, 20).join(', ')}`
      : '',
    opts.topicProfile?.weak.length
      ? `Candidate previously struggled with these topics — prioritize probing them again this session: ${opts.topicProfile.weak.slice(0, 20).join(', ')}`
      : '',
    'Keep questions concise. Probe depth. Be encouraging but rigorous.',
    'Session closing rules:',
    '- When you are finished with your interview questions (especially under 2 minutes left), clearly say you are done with your side, e.g. "That wraps up my questions."',
    '- Then ask: "Do you have any feedback for me?" or "Would you like feedback on your performance today?"',
    '- If the candidate wants feedback: give honest, brief verbal feedback (2–4 sentences) with 1–2 strengths and 1–2 areas to improve, then close professionally.',
    '- If they decline feedback or have no questions, thank them and close warmly.',
    '- If the candidate explicitly asks to end or finish the interview, acknowledge politely and close — do not ask more questions.',
    '- Do not say you are done or end early while more than 2 minutes remain unless the candidate explicitly asks to end.',
    'Conduct this entire interview in English only, and always reply in English. ' +
      'The candidate speaks English (possibly with an accent) — interpret their answers as ' +
      'English even if they sound unusual, and never switch to another language. ' +
      'When transcribing or repeating back anything the candidate said, always write it in ' +
      'English using the Latin alphabet only — never output Hindi, Marathi, or any other ' +
      'non-Latin script, even if their accent sounds like a regional Indian language.',
  ]
    .filter(Boolean)
    .join('\n');
}
