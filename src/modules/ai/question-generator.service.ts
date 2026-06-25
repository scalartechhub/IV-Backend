import { aiService } from "./ai.service";
import { buildQuestionGeneratorPrompt } from "../interview/prompts/question-generator.prompt";
import { logger } from "../../shared/logger";
import { AppError } from "../../shared/utils";
import type {
  ResumeAnalysis,
  JDAnalysis,
  RawQuestion,
  InterviewType,
  DifficultyLevel,
} from "../interview/interview.types";
import { toQuestionDifficulty } from "../interview/interview.types";
interface GenerateQuestionsParams {
  technology?: string;
  experienceLevel?: string;
  difficultyLevel: DifficultyLevel;
  interviewType: InterviewType;
  questionCount: number;
  resumeAnalysis?: ResumeAnalysis;
  jdAnalysis?: JDAnalysis;
  documentsOnly?: boolean;
}

export const generateQuestions = async (params: GenerateQuestionsParams): Promise<RawQuestion[]> => {
  logger.info("[question-generator] generating questions", {
    technology: params.technology,
    difficultyLevel: params.difficultyLevel,
    interviewType: params.interviewType,
    questionCount: params.questionCount,
    documentsOnly: Boolean(params.documentsOnly),
    hasResume: Boolean(params.resumeAnalysis),
    hasJD: Boolean(params.jdAnalysis),
  });

  const prompt = buildQuestionGeneratorPrompt(params);
  const questions = await aiService.generateJSON<RawQuestion[]>(prompt);

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new AppError(500, "AI failed to generate questions. Please try again.");
  }

  const valid = questions
    .filter((q) => typeof q.question === "string" && q.question.length > 0)
    .map((q) => ({
      question: q.question,
      difficulty: toQuestionDifficulty(params.difficultyLevel),
      category:
        typeof q.category === "string" && q.category.length > 0
          ? q.category
          : (params.technology ??
            params.resumeAnalysis?.skills?.[0] ??
            params.jdAnalysis?.requiredSkills?.[0] ??
            "Interview"),
    }));

  const targetCount = params.questionCount;

  if (valid.length < targetCount) {
    logger.warn(`[question-generator] only ${valid.length}/${targetCount} valid questions generated`);
  }

  logger.info(`[question-generator] generated ${valid.length} questions`);
  return valid.slice(0, targetCount);
};
