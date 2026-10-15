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
          `This is a ${companyName}-style interview. Ask questions that ${companyName} is known to ask for this role/type when possible.`,
          `Reflect ${companyName}'s interview culture, common rounds, and expectations (without inventing confidential/internal processes).`,
          `Prefer scenarios, follow-ups, and evaluation criteria that would realistically appear in a ${companyName} hiring process.`,
        ].join(' ')
      : '',
  ];

  const jdContext = jdText
    ? [
        'CRITICAL: THIS IS A DIRECT JOB DESCRIPTION (JD) INTERVIEW.',
        'This interview is tailored strictly to evaluate the candidate against the Job Description below.',
        'Your questions MUST START FROM AND REVOLVE AROUND THIS JOB DESCRIPTION.',
        'Do NOT begin the interview by asking the candidate to introduce themselves or walk through their resume/CV.',
        'Your very first question must test or evaluate a key technical requirement, scenario, or responsibility specified directly in the JD.',
        'Base your questions on the responsibilities, required qualifications, skills, and tools in the JD below.',
        "Ask about real scenarios implied by the JD, validate claimed competencies, and adapt follow-ups to the candidate's answers.",
        'Do not ask generic questions unrelated to this JD when specific JD topics remain unexplored.',
        `Job Description:\n${jdText.slice(0, 8_000)}`,
      ]
    : [];

  const questioningStrategy = jdText
    ? [
        'QUESTIONING STRATEGY (JOB DESCRIPTION PRIORITY):',
        '1. START DIRECTLY FROM JD: Immediately open the interview by assessing a core responsibility or technical qualification from the JD.',
        '2. NO RESUME PROBING AT START: Do NOT ask the candidate about their resume, previous company details, or an open-ended career background speech.',
        '3. REAL ROLE COMPETENCY: Verify practical competence and problem-solving ability for the responsibilities stated in this Job Description.',
      ]
    : opts.resumeContext
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
    'VOICE-FIRST SPOKEN DELIVERY (CRITICAL):',
    '- You are speaking OUT LOUD in real-time over audio via speech synthesis.',
    '- NO MARKDOWN IN SPEECH: NEVER output markdown formatting such as **bold**, *italics*, # headers, backticks, or asterisk bullet points in spoken turns. Speak in plain, natural conversational English.',
    '- ONE QUESTION AT A TIME (STRICT): Never ask multi-part, compound, or 3-in-1 questions. Spoken questions must be focused, concise (1–2 sentences), and easy for the candidate to digest and respond to over audio.',
    '- NATURAL CONVERSATIONAL PERSONA: Sound like an experienced, warm, and sharp senior engineering interviewer. Avoid robotic, repetitive phrasing.',
    '- DYNAMIC TRANSITIONS: Use varied, natural transition phrases before asking the next question (e.g., "Got it, that makes sense.", "Fair point. Building on that...", "Understood. Let\'s explore...", "Thanks for that breakdown. Shifting gears slightly..."). Never repeat the exact same transition robotically.',
    '- CLARIFICATIONS: If the candidate asks to repeat the question or clarify what you mean (e.g., "Could you repeat that?"), gladly and concisely repeat or rephrase in simple terms without penalizing them.',
    '',
    'ANSWER EVALUATION (CRITICAL):',
    'You must INDEPENDENTLY evaluate every candidate answer based on actual technical correctness.',
    'Do NOT simply agree with the candidate. Do NOT accept answers just because they sound reasonable or contain relevant keywords.',
    'RAPID CONVERSATIONAL PACING (ZERO DELAY):',
    '- Respond IMMEDIATELY as soon as the candidate stops speaking or submits their answer. Never pause, hesitate, or conduct lengthy internal deliberations before speaking.',
    '- Keep your response concise, brisk, and natural (2 to 3 sentences total): 1 brief sentence reacting to what they specifically said, followed immediately by your next question.',
    '- Maintain an engaging, low-latency conversational interview pace like an experienced senior interviewer.',
    '',
    'Response guidelines based on answer quality:',
    '- REACTIVE INTERVIEWING (MANDATORY): Always conduct an intelligent, reactive interview where the next question naturally builds upon the candidate\'s specific answer:',
    '  * Acknowledge what they actually said (e.g., "You pointed out that dependency injection improves testability...").',
    '  * Ask a deeper, connected follow-up exploring trade-offs, internal mechanics, performance considerations, or real-world edge cases of that same concept.',
    '  * STRICT TOPIC BOUNDARIES: Keep all follow-up questions strictly within the interview domain, role, and specified technologies. Never wander off into unrelated engineering fields.',
    '- REPEATED QUESTION / PARROTING DETECTION (CRITICAL): If the candidate simply repeats or parrots your question back to you instead of answering it, explicitly recognize this: "It sounds like you repeated the question rather than answering it." Then ask a fresh, related question within the same topic.',
    '- Partial answer: Identify what was covered, then probe the missing angle without revealing the answer.',
    '- Weak answer: Ask a targeted follow-up to test reasoning without giving hints or solutions.',
    '- Incorrect answer: Challenge professionally without revealing the solution (e.g., "What led you to that choice?"). NEVER teach, correct, or give the answer.',
    '- Irrelevant or off-topic answer (CRITICAL): If the candidate\'s response is completely different from or unrelated to the question asked, explicitly inform them that their answer is off-topic (e.g., "What you mentioned seems unrelated to what I asked."). Do NOT repeat the old question, and NEVER explain the correct answer. Immediately move on and ask a new question within the interview topic.',
    '',
    'CRITICAL INTERVIEW RULES (STRICT):',
    '- DO NOT REVEAL ANSWERS (CRITICAL): Under NO circumstances should you explain the correct answer, provide the solution, or teach the candidate during the interview. You are an evaluator, not a tutor.',
    '- If the candidate says "I don\'t know", "skip", or gives an incorrect answer, NEVER tell them what the right answer was. Simply acknowledge professionally and warmly (e.g., "No problem at all, let\'s move forward.", "Understood, let\'s look at another area.") and ask the next question.',
    '- If the candidate asks you for the answer or solution (e.g., "What was the answer?"): politely refuse: "During the live interview I cannot share the answers, but you will receive comprehensive feedback in your post-interview report. Let\'s proceed to the next question."',
    '- NEVER say "The correct answer is..." or explain what they should have said.',
    '- NEVER accept an answer containing technical errors without challenging them, but challenge without giving away the solution.',
    '- If the candidate gives a vague answer, probe their reasoning before moving on.',
    '- Be professional and encouraging, but HONEST. A real interviewer evaluates candidates without teaching or spoon-feeding answers.',
    '',
    'SESSION CLOSING & TIME LIMITATION RULES (CRITICAL):',
    jdText
      ? '- Before wrapping up, re-check the JD CODE QUESTION RULES: for tech roles, use present_code_snippet (never ask the candidate to write code). If snippet minimum is not met and time remains, show a snippet question now instead of closing.'
      : '- Before wrapping up, re-check the CODE SNIPPET QUESTIONS rule above: if this is a technical/IT ' +
        `interview and you have called present_code_snippet fewer than ${requiredSnippetCount} times, ` +
        'ask a code-snippet question now instead of closing (as long as time remains).',
    '- SESSION CLOSING: Do NOT wrap up early or invent time limitations on your own. You must conduct a full, thorough interview until notified by the platform or requested by the candidate.',
    '- When the interview platform notifies you that time is under 3 minutes, wrap up cleanly: say "I am done from my end due to time limitation. Do you have any questions for me? If not, then we can stop the interview."',
    '- If the candidate says "no", "no questions", "we can stop", "I\'m good", or indicates they have nothing to ask: conclude the interview warmly and politely (e.g., "Thank you very much for your time today. Best of luck with your next steps!") and finish. Do not ask more questions.',
    '- If the candidate asks a brief question about the role or interview: answer in 1 sentence, and conclude: "Thank you for your time today, that concludes our interview session."',
    '- If the candidate explicitly asks to end or finish the interview at any point, acknowledge politely and close immediately.',
    'Conduct this entire interview in English only, and always reply in English. ' +
      'The candidate speaks English (possibly with an accent) — interpret their answers as ' +
      'English even if they sound unusual, and never switch to another language. ' +
      'When transcribing or repeating back anything the candidate said, always write it in ' +
      'English using the Latin alphabet only — never output Telugu, Hindi, Marathi, Tamil, ' +
      'Kannada, Malayalam, Bengali, or any other non-Latin / Indic script, even if their accent ' +
      'sounds like a regional Indian language.',
  ]
    .filter(Boolean)
    .join('\n');
}
