export const buildResumeParserPrompt = (resumeText: string): string => `
You are an expert resume parser with years of experience in technical recruiting.

Analyze the following resume text and extract structured information.

Resume Text:
---
${resumeText}
---

Instructions:
- Extract all technical skills (programming languages, frameworks, tools, platforms)
- Extract project descriptions (name + brief what it does)
- Extract work experience entries (role + company + what was done)
- Extract education entries (degree + institution + year)
- Be thorough but concise

Return ONLY a valid JSON object with this exact structure. No markdown, no explanation, no extra text:
{
  "skills": ["TypeScript", "React", "Node.js"],
  "projects": ["Built an e-commerce platform using React and Node.js with real-time inventory tracking"],
  "experience": ["Software Engineer at Acme Corp (2021-2023): Developed REST APIs, reduced latency by 30%"],
  "education": ["B.Tech Computer Science, IIT Delhi, 2021"]
}
`.trim();
