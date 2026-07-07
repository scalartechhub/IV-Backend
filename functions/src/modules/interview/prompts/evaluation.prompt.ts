interface EvaluationParams {
  question: string;
  answer: string;
  role: string;
  difficulty: string;
  category: string;
}

export const buildEvaluationPrompt = (params: EvaluationParams): string => {
  const { question, answer, role, difficulty, category } = params;

  return `
You are an expert technical interviewer evaluating a candidate's answer for a ${role} position.

Question (${difficulty} difficulty, category: ${category}):
"${question}"

Candidate's Answer:
"${answer}"

Evaluate the answer across these four dimensions on a scale of 0-10:

- technical (0-10): Accuracy of technical content, correct use of concepts, depth of knowledge
- communication (0-10): Clarity, structure, use of examples, ease of understanding
- completeness (0-10): How fully the question was addressed, are all key points covered
- confidence (0-10): Decisiveness of the answer, absence of unnecessary hedging

Scoring guide:
- 0-3: Poor / Incorrect
- 4-5: Basic / Partially correct
- 6-7: Good / Correct with minor gaps
- 8-9: Strong / Comprehensive
- 10: Exceptional / Beyond expectations

Provide constructive, actionable feedback (2-4 sentences) highlighting what was good and what could be improved.

Return ONLY a valid JSON object. No markdown, no explanation:
{
  "technical": 7,
  "communication": 8,
  "completeness": 6,
  "confidence": 7,
  "feedback": "The candidate demonstrated solid understanding of the core concept but missed mentioning edge cases. The explanation was clear and well-structured. To improve, consider discussing practical implications and real-world usage patterns."
}
`.trim();
};

export interface BatchEvaluationItem {
  questionId: string;
  question: string;
  answer: string;
  difficulty: string;
  category: string;
}

interface BatchEvaluationParams {
  technology: string;
  items: BatchEvaluationItem[];
}

export const buildBatchEvaluationPrompt = (params: BatchEvaluationParams): string => {
  const { technology, items } = params;

  const qaBlocks = items
    .map(
      (item, index) =>
        `[${index + 1}] questionId: "${item.questionId}"
Question (${item.difficulty}, ${item.category}): "${item.question}"
Answer: "${item.answer}"`
    )
    .join("\n\n");

  return `
You are an expert technical interviewer evaluating a candidate's answers for a ${technology} position.

Evaluate EACH answer below independently across four dimensions (0-10):
- technical: Accuracy of technical content, correct use of concepts, depth of knowledge
- communication: Clarity, structure, use of examples, ease of understanding
- completeness: How fully the question was addressed, are all key points covered
- confidence: Decisiveness of the answer, absence of unnecessary hedging

Scoring guide:
- 0-3: Poor / Incorrect
- 4-5: Basic / Partially correct
- 6-7: Good / Correct with minor gaps
- 8-9: Strong / Comprehensive
- 10: Exceptional / Beyond expectations

Answers to evaluate:
---
${qaBlocks}
---

Return ONLY a valid JSON array with one object per answer, in the same order as above.
Each object MUST include the exact questionId from the input.
Provide constructive feedback (2-4 sentences) per answer.

[
  {
    "questionId": "exact-id-from-input",
    "technical": 7,
    "communication": 8,
    "completeness": 6,
    "confidence": 7,
    "feedback": "Constructive feedback for this answer."
  }
]
`.trim();
};
