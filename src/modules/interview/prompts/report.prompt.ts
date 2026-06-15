import type { Question, Answer, Evaluation } from "../interview.types";

interface ReportParams {
  role: string;
  experience: string;
  questions: Question[];
  answers: Answer[];
  evaluations: Evaluation[];
}

export const buildReportPrompt = (params: ReportParams): string => {
  const { role, experience, questions, answers, evaluations } = params;

  const qaSection = questions
    .map((q) => {
      const answer = answers.find((a) => a.questionId === q.id);
      const evaluation = evaluations.find((e) => e.questionId === q.id);

      return [
        `[${q.difficulty.toUpperCase()} | ${q.category}] Q: ${q.question}`,
        `A: ${answer?.answer ?? "(no answer provided)"}`,
        evaluation
          ? `Scores → technical:${evaluation.technical}, communication:${evaluation.communication}, completeness:${evaluation.completeness}, confidence:${evaluation.confidence}`
          : "Scores → not evaluated",
      ].join("\n");
    })
    .join("\n\n");

  return `
You are generating a comprehensive final interview report for a ${role} candidate with ${experience} of experience.

Complete Interview Transcript with Scores:
---
${qaSection}
---

Based on the above, generate a professional final report.

Instructions:
- Calculate an overall score (0-100) that reflects the aggregate performance
- Identify 3-5 specific strengths demonstrated by the candidate
- Identify 2-4 specific areas for improvement (weaknesses)
- Provide 3-5 actionable, specific recommendations for the candidate

Return ONLY a valid JSON object. No markdown, no explanation:
{
  "overallScore": 72,
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
