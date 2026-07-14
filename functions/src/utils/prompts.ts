// backend/src/utils/prompts.ts

export interface Topic {
  id: string;
  title: string;
  description: string;
  systemPrompt: string;
}

export interface Message {
  role: 'user' | 'bot';
  text: string;
}

export const getConversationPrompt = (
  topic: Topic,
  history: Message[],
  userMessage: string,
): string => {
  const historyText =
    history.length > 0
      ? history.map((h) => `${h.role === 'user' ? 'User' : 'Bot'}: ${h.text}`).join('\n')
      : 'This is the start of the conversation.';

  return `
You are an expert, friendly conversationalist acting as a helpful assistant.

TOPIC CONTEXT:
${topic.systemPrompt}

CONVERSATION HISTORY:
${historyText}

USER'S LATEST INPUT: "${userMessage}"

YOUR TASK:
1. Review the complete conversation history and the user's latest input.
2. Acknowledge the user's input and reply naturally in 1-2 concise, friendly lines.
3. Generate the next logical, context-aware question to keep the conversation going. 
   - Do not repeat previous questions.
   - Base it on the user's earlier answers and latest input.
   - The nextQuestion must be a single, concise line.
4. If the user explicitly wants to end the chat or says goodbye, acknowledge it gracefully and set "nextQuestion" to an empty string "".

CRITICAL FORMATTING RULE:
Return ONLY a valid, raw JSON object. Do NOT wrap the output in markdown code blocks (like \`\`\`json or \`\`\`). Do NOT include any conversational text outside the JSON object.

Exact JSON format required:
{
  "reply": "Your contextual reply here",
  "nextQuestion": "Your next dynamic question here"
}
`.trim();
};