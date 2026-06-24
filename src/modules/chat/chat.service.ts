import type { Content } from "@google/genai";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { appConfig } from "../../config/app.config";
import { db } from "../../config/firebase";
import { getGenAI } from "../../config/gemini";
import { CHAT_COLLECTIONS } from "../../shared/constants";
import { AppError } from "../../shared/utils";

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
  if (!snapshot.exists) throw new AppError(404, "Conversation not found. Please start a new chat.");
  if (snapshot.data()!.userId !== userId) {
    throw new AppError(403, "You do not have permission to access this conversation.");
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

export const sendMessage = async (userId: string, input: SendMessageInput) => {
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
  const contents: Content[] = [
    ...history.map((message) => ({
      role: message.role,
      parts: [{ text: message.text }],
    })),
    { role: "user", parts: [{ text: input.message }] },
  ];

  let response;
  try {
    response = await getGenAI().models.generateContent({
      model: appConfig.geminiModel,
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.5,
        maxOutputTokens: 1_024,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/API_KEY_INVALID|API key not valid/i.test(message)) {
      throw new AppError(500, "Gemini API key is invalid");
    }
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(message)) {
      throw new AppError(429, "AI usage limit reached. Please try again later.");
    }
    throw new AppError(502, "AI service temporarily unavailable");
  }

  const reply = response.text?.trim();
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
    model: appConfig.geminiModel,
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
  batch.update(getConversations().doc(conversationId), { updatedAt: assistantTime });
  await batch.commit();

  return {
    conversationId,
    message: assistantMessage,
    usage: response.usageMetadata
      ? {
          promptTokens: response.usageMetadata.promptTokenCount,
          responseTokens: response.usageMetadata.candidatesTokenCount,
          totalTokens: response.usageMetadata.totalTokenCount,
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
