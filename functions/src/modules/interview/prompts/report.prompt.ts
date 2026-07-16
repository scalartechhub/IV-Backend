import type { InterviewQuestion } from "../interview.types";

interface ReportParams {
  technology: string;
  experienceLevel: string;
  questions: InterviewQuestion[];
}

export const buildReportPrompt = (params: ReportParams): string => {
  const { technology, experienceLevel, questions } = params;

  const qaSection = questions
    .map((q) =>
      [
        `[${q.difficulty.toUpperCase()}] Q: ${q.question}`,
        `A: ${q.answer ?? "(no answer provided)"}`,
        q.score !== undefined
          ? `Score: ${q.score}/10 — ${q.feedback ?? "No feedback"}`
          : "Score: not evaluated",
      ].join("\n")
    )
    .join("\n\n");

  return `
You are generating a comprehensive final interview report for a ${technology} candidate with ${experienceLevel} of experience.

Complete Interview Transcript with Scores:
---
${qaSection}
---

Based on the above, generate a professional final report.

Instructions:
- Analyze ALL answers together (content quality, correctness, depth, consistency, and coverage across the interview). Then assign overallScore (0-100) as a holistic judgment of the candidate's performance — do NOT compute it as an average of per-question scores.
- overallScore MUST be 0 when every answer is empty, missing, "I don't know/remember", off-topic, nonsensical, or scored 0. Do not award consolation points for honesty or effort alone.
- Empty, missing, off-topic, nonsensical, or largely wrong answers must heavily lower overallScore. Strong fluency alone must not inflate the score when answers are incorrect or shallow.
- Write a concise executive summary (2-4 sentences)
- Identify 3-5 specific strengths demonstrated by the candidate
- Identify 2-4 specific areas for improvement (weaknesses)
- Provide 3-5 actionable, specific recommendations for the candidate

Return ONLY a valid JSON object. No markdown, no explanation:
{
  "overallScore": 72,
  "summary": "The candidate demonstrated solid fundamentals with room to grow in advanced topics.",
  "strengths": [
    "Strong understanding of React component lifecycle",
    "Clear communication style with good use of examples"
  ],
  "weaknesses": [
    "Limited knowledge of system design at scale",
    "Needs to deepen TypeScript type system knowledge"
  ],
  "recommendations": [
    "Study distributed systems fundamentals using resources like Designing Data-Intensive Applications",
    "Practice TypeScript generics and advanced type patterns through hands-on projects",
    "Build and deploy a full-stack project to strengthen end-to-end understanding"
  ]
}
`.trim();
};
