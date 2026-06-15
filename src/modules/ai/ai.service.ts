import { getGenAI, GEMINI_MODEL } from "../../config/gemini";
import { logger } from "../../shared/logger";
import { AppError, safeJsonParse } from "../../shared/utils";

export class AIService {
  async generateJSON<T>(prompt: string): Promise<T> {
    try {
      const genai = getGenAI();
      const response = await genai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.3,
          maxOutputTokens: 4096,
        },
      });

      const text = response.text;
      if (!text) throw new AppError(500, "Gemini returned empty JSON response");

      return safeJsonParse<T>(text);
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error("[AIService] generateJSON failed", error);
      throw new AppError(502, "AI service temporarily unavailable. Please try again.");
    }
  }
}

export const aiService = new AIService();
