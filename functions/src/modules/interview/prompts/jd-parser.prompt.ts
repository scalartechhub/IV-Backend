export const buildJDParserPrompt = (jdText: string): string => `
You are an expert job description analyst with deep knowledge of technical hiring requirements.

Analyze the following job description and extract structured information.

Job Description:
---
${jdText}
---

Instructions:
- Extract all required and preferred technical skills
- Extract key job responsibilities and duties
- Extract experience requirements (years, level, domain)

Return ONLY a valid JSON object. No markdown, no explanation, no extra text:
{
  "requiredSkills": ["React", "TypeScript", "REST APIs", "SQL"],
  "responsibilities": ["Design and implement frontend features", "Collaborate with backend teams", "Write unit tests"],
  "experience": ["3+ years of frontend development", "Experience with agile methodologies"]
}
`.trim();
