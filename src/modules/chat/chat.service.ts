import { FieldValue, Timestamp } from "firebase-admin/firestore";
import Groq from "groq-sdk";
import { appConfig } from "../../config/app.config";
import { db } from "../../config/firebase";
import { CHAT_COLLECTIONS } from "../../shared/constants";
import { AppError } from "../../shared/utils";

// Initialize Groq Client
const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

interface SendMessageInput {
  conversationId?: string;
  message: string;
}

interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "model";
  text: string;
  model?: string;
  createdAt: Timestamp;
}

const HISTORY_LIMIT = 20;
const SYSTEM_INSTRUCTION =
  "You are a helpful assistant. Be accurate, concise, and transparent about uncertainty.";

const getConversations = () => db.collection(CHAT_COLLECTIONS.CONVERSATIONS);
const messageCollection = (conversationId: string) =>
  getConversations().doc(conversationId).collection(CHAT_COLLECTIONS.MESSAGES);

const requireOwnedConversation = async (
  conversationId: string,
  userId: string
): Promise<void> => {
  const snapshot = await getConversations().doc(conversationId).get();
  if (!snapshot.exists)
    throw new AppError(404, "Conversation not found. Please start a new chat.");
  if (snapshot.data()!.userId !== userId) {
    throw new AppError(
      403,
      "You do not have permission to access this conversation."
    );
  }
};

const getRecentMessages = async (
  conversationId: string,
  limit: number
): Promise<ChatMessage[]> => {
  const snapshot = await messageCollection(conversationId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => doc.data() as ChatMessage).reverse();
};

export const sendMessage = async (
  userId: string,
  input: SendMessageInput
) => {
  let conversationId = input.conversationId;

  if (conversationId) {
    await requireOwnedConversation(conversationId, userId);
  } else {
    const ref = getConversations().doc();
    conversationId = ref.id;
    await ref.set({
      id: ref.id,
      userId,
      title: input.message.slice(0, 80),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const history = await getRecentMessages(conversationId, HISTORY_LIMIT);

  // Convert DB messages to Groq/OpenAI format
  // FIX: Explicitly cast roles to satisfy TypeScript strict types
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_INSTRUCTION },
    ...history.map((msg) => ({
      role: (msg.role === "model" ? "assistant" : "user") as "assistant" | "user",
      content: msg.text,
    })),
    { role: "user", content: input.message },
  ];

  let completion;
  try {
    completion = await groqClient.chat.completions.create({
      messages,
      model: appConfig.groqModel,
      temperature: 0.5,
      max_tokens: 1024,
      top_p: 1,
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    
    if (error.status === 401) {
      throw new AppError(500, "Groq API key is invalid");
    }
    if (error.status === 429 || /rate_limit|quota/i.test(message)) {
      throw new AppError(429, "AI usage limit reached. Please try again later.");
    }
    throw new AppError(502, "AI service temporarily unavailable");
  }

  const reply = completion.choices[0]?.message?.content?.trim();
  
  if (!reply) throw new AppError(502, "AI service returned an empty response");

  const userRef = messageCollection(conversationId).doc();
  const assistantRef = messageCollection(conversationId).doc();
  const now = Timestamp.now();
  const assistantTime = Timestamp.fromMillis(now.toMillis() + 1);
  
  const assistantMessage: ChatMessage = {
    id: assistantRef.id,
    conversationId,
    role: "model",
    text: reply,
    model: appConfig.groqModel,
    createdAt: assistantTime,
  };

  const batch = db.batch();
  batch.set(userRef, {
    id: userRef.id,
    conversationId,
    role: "user",
    text: input.message,
    createdAt: now,
  });
  batch.set(assistantRef, assistantMessage);
  batch.update(getConversations().doc(conversationId), {
    updatedAt: assistantTime,
  });
  await batch.commit();

  return {
    conversationId,
    message: assistantMessage,
    usage: completion.usage
      ? {
          promptTokens: completion.usage.prompt_tokens,
          responseTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        }
      : undefined,
  };
};

export const getMessages = async (
  userId: string,
  conversationId: string,
  limit: number
): Promise<ChatMessage[]> => {
  await requireOwnedConversation(conversationId, userId);
  return getRecentMessages(conversationId, limit);
};