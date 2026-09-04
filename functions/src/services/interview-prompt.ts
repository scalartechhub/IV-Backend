import type {
  InterviewConfig,
  InterviewFocusAreas,
  InterviewMode,
} from '../interfaces/interview.interface';
import type { ResumeDoc } from '../interfaces/resume.interface';
import { requiredSnippetQuestionCount } from '../library/code-snippet';

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

function buildFocusAreasInstructions(
  focus?: InterviewFocusAreas,
  opts?: { jdBased?: boolean },
): string[] {
  if (!focus) return [];

  const areas: string[] = [];
  if (focus.technical) areas.push('technical knowledge and domain depth');
  if (focus.coding) {
    areas.push(
      opts?.jdBased
        ? 'code comprehension, debugging, and reasoning about provided code snippets'
        : 'coding problems, algorithms, and implementation',
    );
  }
  if (focus.behavioral) areas.push('behavioral and situational judgment (STAR-style)');
  if (focus.problemSolving) areas.push('applied problem solving and analytical thinking');
  if (focus.communication) areas.push('communication clarity and structured explanations');

  if (!areas.length) return [];

  return [
    'Evaluation focus areas for this session:',
    `- Prioritize questions that assess: ${areas.join('; ')}.`,
    '- Weight follow-ups and scoring toward these focus areas.',
    '- Avoid spending significant time on areas not listed above unless needed for context.',
  ];
}

function buildJdCodingInstructions(requiredSnippetCount: number): string[] {
  return [
    'JD INTERVIEW — CODE QUESTION RULES (CRITICAL):',
    '- This is a voice-only interview. There is NO code editor and the candidate CANNOT write or type code.',
    '- NEVER ask the candidate to write, implement, code, or type a solution (e.g. "write a function", "implement this in Python", "code this up").',
    '- For algorithm, debugging, or implementation topics: you MUST call present_code_snippet FIRST with the code on screen, then ask the candidate to explain, predict output, find bugs, analyze complexity, or describe how they would fix it verbally.',
    '- Treat coding assessment as "think through given code" — comprehension, reasoning, and trade-off discussion only.',
    '- For technology/software/IT roles: ask at least ' +
      `${requiredSnippetCount} code-snippet question${requiredSnippetCount === 1 ? '' : 's'} ` +
      'using present_code_snippet before the interview ends.',
    '- For non-technical domains: never call present_code_snippet.',
    '- Do not describe code only in speech — always use the tool so the snippet appears in the UI.',
    '- Space snippet questions through the session, mainly in the second half after conceptual JD questions.',
  ];
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
  const effectiveMode: InterviewMode =
    config.jobDescriptionText?.trim() && mode === 'coding' ? 'conversational' : mode;
  const interviewType = interviewModeLabel(effectiveMode);
  const technology = primaryTechnology(config);
  const difficulty =
    config.difficulty.charAt(0).toUpperCase() + config.difficulty.slice(1);

  const requiredSnippetCount = requiredSnippetQuestionCount(config.durationMinutes);
  const companyName = config.company?.trim();
  const jdText = config.jobDescriptionText?.trim();
  const coreConfig = [
    `You are an expert interviewer conducting a ${interviewType}.`,
    `Interview type: ${interviewType}.`,
    MODE_FOCUS[effectiveMode],
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
          config.targetRole ? `Candidate role: ${config.targetRole}.` : '',
          `This is a ${companyName}-style interview tailored for ${config.targetRole || 'this position'}. Ask questions that ${companyName} is known to ask for this role/type when possible.`,
          `Reflect ${companyName}'s interview culture, common rounds, and evaluation expectations (without inventing confidential/internal processes).`,
          `Prefer scenarios, follow-ups, and evaluation criteria that would realistically appear in a ${companyName} hiring process.`,
        ].filter(Boolean).join(' ')
      : '',
  ];

  const jdContext = jdText
    ? [
        'This interview was created from a specific Job Description (JD).',
        'Base your questions on the responsibilities, skills, tools, and qualifications in the JD below.',
        "Ask about real scenarios implied by the JD, validate claimed competencies, and adapt follow-ups to the candidate's answers.",
        'Do not ask generic questions unrelated to this JD when specific JD topics remain unexplored.',
        `Job Description:\n${jdText.slice(0, 8_000)}`,
      ]
    : [];

  const questioningStrategy = opts.resumeContext
    ? [
        'The candidate opted in to resume-based questioning.',
        'Use the resume signals below to tailor questions to their real projects, employers, skills, and gaps.',
        'Reference specific experiences when possible and validate claimed skills with concrete follow-ups.',
        `Resume signals:\n${opts.resumeContext}`,
      ]
    : jdText
      ? [
          'Resume context was NOT provided for this session.',
          'Generate questions using the interview type, technology, difficulty, duration, and the Job Description above.',
          'Do not assume specific employers, projects, degrees, or resume details beyond what the JD states.',
        ]
      : [
          'Resume context was NOT provided for this session.',
          'Generate questions using ONLY the interview type, technology, difficulty, and duration above.',
          'Do not assume specific employers, projects, degrees, or resume details.',
        ];

  return [
    ...coreConfig,
    ...jdContext,
    ...buildFocusAreasInstructions(config.focusAreas, { jdBased: Boolean(jdText) }),
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
    '',
    ...(jdText
      ? buildJdCodingInstructions(requiredSnippetCount)
      : [
          'CODE SNIPPET QUESTIONS:',
          '- First decide: is this interview for a technology/software/IT/coding-engineering role, ' +
            'based on the target role, technologies, skills, and topic above? Non-technical domains ' +
            '(e.g. marketing, sales, civil/mechanical/other non-software engineering, pure HR or ' +
            'behavioral-only screens) do NOT need this.',
          `- If YES: you MUST ask at least ${requiredSnippetCount} code-snippet-based question${requiredSnippetCount === 1 ? '' : 's'} ` +
            'before the interview ends, using the present_code_snippet tool. Do not just describe code ' +
            'verbally — call the tool with the exact code, its language, and the question you are asking ' +
            'about it (e.g. "what does this return?", "find the bug", "what is the output?"). Space them ' +
            'out through the session — ask them mainly in the second half, after conceptual questions, so ' +
            'the candidate is warmed up.',
          '- If NO (non-technical domain): never call the present_code_snippet tool.',
          `- Keep track of how many you have called it. Before your closing remarks, verify you have met ` +
            `the ${requiredSnippetCount}-question minimum (if this is a technical/IT interview); if not ` +
            'met and time remains, ask one now instead of wrapping up.',
        ]),
    '',
    'ANSWER EVALUATION (CRITICAL):',
    'You must INDEPENDENTLY evaluate every candidate answer based on actual technical correctness.',
    'Do NOT simply agree with the candidate. Do NOT accept answers just because they sound reasonable or contain relevant keywords.',
    '',
    'For every answer, internally assess:',
    '1. CORRECTNESS — Is the technical information factually accurate?',
    '2. RELEVANCE — Does the answer directly address the question asked?',
    '3. COMPLETENESS — Did the candidate cover the important concepts?',
    '4. PRACTICAL UNDERSTANDING — Does the candidate demonstrate real-world experience?',
    '5. TECHNICAL DEPTH — Is the explanation appropriate for the expected experience level?',
    '6. CONSISTENCY — Does the answer contradict anything previously stated?',
    '7. MISCONCEPTIONS — Does the candidate have incorrect understanding?',
    '8. EXAMPLES — If examples are given, are they technically valid?',
    '',
    'Response guidelines based on answer quality:',
    '- Strong answer: Acknowledge briefly, then ask a harder follow-up or move to next topic.',
    '- Partial answer: Identify what was correct, then probe the gaps. Say: "You correctly identified X, but can you elaborate on Y?"',
    '- Weak answer: Ask targeted follow-ups. Say: "Can you walk me through a specific scenario where you applied this?"',
    '- Incorrect answer: Challenge professionally. Say: "I\'d push back on that — [brief correction]. How would this change your approach?"',
    '- Irrelevant answer: Redirect. Say: "That\'s interesting, but it doesn\'t address what I asked. Let me rephrase..."',
    '',
    'CRITICAL evaluation rules:',
    '- NEVER say "That\'s correct!" to an incomplete or partially correct answer.',
    '- NEVER accept an answer containing technical errors without challenging them.',
    '- When the candidate makes a technical claim, verify it against your knowledge. If wrong, say so clearly.',
    '- If the candidate gives a vague answer, ALWAYS probe deeper before moving on.',
    '- Track claims throughout the interview. If they contradict themselves, note it.',
    '- Be professional and encouraging, but HONEST. A real interviewer would not accept incorrect answers.',
    '',
    'Session closing rules:',
    jdText
      ? '- Before wrapping up, re-check the JD CODE QUESTION RULES: for tech roles, use present_code_snippet (never ask the candidate to write code). If snippet minimum is not met and time remains, show a snippet question now instead of closing.'
      : '- Before wrapping up, re-check the CODE SNIPPET QUESTIONS rule above: if this is a technical/IT ' +
        `interview and you have called present_code_snippet fewer than ${requiredSnippetCount} times, ` +
        'ask a code-snippet question now instead of closing (as long as time remains).',
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
