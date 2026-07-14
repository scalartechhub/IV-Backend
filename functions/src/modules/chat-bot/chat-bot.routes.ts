import { Router, Request, Response } from "express";
import { db } from "../../config/firebase"; // Adjust path to your Firebase Admin setup

// TODO: Adjust these import paths to match your actual project structure
import { geminiModel } from "../../config/gemini";
import { getConversationPrompt, Topic } from "../../utils/prompts";

const router = Router();

// ✅ 1. GET /api/chat-bot/topics

router.get("/topics", async (req: Request, res: Response) => {
  try {
    const snapshot = await db.collection("chat_bot_topics").get();

    const topics = snapshot.docs.map((doc) => ({
      id: doc.id, // e.g., "career-advice"
      ...doc.data(),
    }));

    // Matches Angular service expectation: response.data?.topics ?? response.topics
    res.json({ success: true, data: { topics } });
  } catch (error: any) {
    console.error("Error fetching topics:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch topics",
      details: error.message,
    });
  }
});

// ✅ 2. POST /api/chat-bot/start

// ✅ 2. POST /api/chat-bot/start
router.post("/chatSessions", async (req: Request, res: Response) => {
  try {
    const { topicId } = req.body;
    if (!topicId) {
      return res
        .status(400)
        .json({ success: false, message: "topicId is required" });
    }

    // Fetch topic directly from Firestore
    const topicDoc = await db.collection("chat_bot_topics").doc(topicId).get();

    if (!topicDoc.exists) {
      return res
        .status(404)
        .json({ success: false, message: "Topic not found" });
    }

    const topicData = topicDoc.data() as any;

    // ✅ FIX: Explicitly construct the topic object including the ID
    // topicDoc.data() does NOT include the document ID automatically
    const topic: Topic = {
      id: topicDoc.id, // <-- This fixes the "undefined" error
      title: topicData.title,
      description: topicData.description || "",
      systemPrompt: topicData.systemPrompt,
    };

    // Generate the first question using Gemini
    const firstQPrompt = `You are an expert. Topic: ${topic.systemPrompt}. 
    Ask the user an engaging, open-ended introductory question to start the conversation. 
    Keep the question concise and limited to one line.
    Return ONLY valid JSON: {"nextQuestion": "string"}`;

    const result = await geminiModel.generateContent(firstQPrompt);
    const data = parseGeminiJSON(result.response.text());

    // Save the new session to Firestore
    const sessionRef = await db.collection("chatSessions").add({
      topicId: topic.id,
      topicTitle: topic.title,
      systemPrompt: topic.systemPrompt,
      history: [{ role: "bot", text: data.nextQuestion }],
      status: "active",
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    });

    res.json({
      success: true,
      data: {
        sessionId: sessionRef.id,
        firstQuestion: data.nextQuestion,
      },
    });
  } catch (error: any) {
    console.error("Start chat error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Failed to start chat",
        details: error.message,
      });
  }
});

// ✅ 3. POST /api/chat-bot/message

router.post("/message", async (req: Request, res: Response) => {
  try {
    const { sessionId, userMessage } = req.body;

    if (!sessionId || !userMessage) {
      return res.status(400).json({
        success: false,
        message: "sessionId and userMessage are required",
      });
    }

    const sessionDoc = await db.collection("chatSessions").doc(sessionId).get();

    if (!sessionDoc.exists) {
      return res
        .status(404)
        .json({ success: false, message: "Session not found" });
    }

    const session = sessionDoc.data() as any;

    // SAFETY CHECK: Fallback to empty array if history is missing/undefined
    const currentHistory = Array.isArray(session.history)
      ? session.history
      : [];

    // Reconstruct the Topic object from the session data for the prompt generator
    const topicContext: Topic = {
      id: session.topicId,
      title: session.topicTitle,
      description: "", // Not strictly needed for the prompt
      systemPrompt: session.systemPrompt,
    };

    // 1. Add user message to history
    const updatedHistory = [
      ...currentHistory,
      { role: "user", text: userMessage },
    ];

    // 2. Ask Gemini for reply + next question using your helper function
    const prompt = getConversationPrompt(
      topicContext,
      updatedHistory,
      userMessage,
    );
    const result = await geminiModel.generateContent(prompt);
    const aiResponse = parseGeminiJSON(result.response.text());

    // 3. Update history with bot's full response
    const fullBotResponse = `${aiResponse.reply}\n\n${aiResponse.nextQuestion}`;
    updatedHistory.push({ role: "bot", text: fullBotResponse });

    // 4. Save back to Firestore
    await sessionDoc.ref.update({
      history: updatedHistory,
      lastUpdated: new Date().toISOString(),
    });

    // Matches Angular service expectation: response.data.reply ?? response.reply
    res.json({
      success: true,
      data: {
        reply: aiResponse.reply,
        nextQuestion: aiResponse.nextQuestion,
      },
    });
  } catch (error: any) {
    console.error("Message error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process message",
      details: error.message,
    });
  }
});

function parseGeminiJSON(text: string): any {
  try {
    return JSON.parse(text);
  } catch (e) {
    const cleanedText = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    return JSON.parse(cleanedText);
  }
}

export default router;
