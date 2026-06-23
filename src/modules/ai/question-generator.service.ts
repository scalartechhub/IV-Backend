import { aiService } from "./ai.service";
import { buildQuestionGeneratorPrompt } from "../interview/prompts/question-generator.prompt";
import { logger } from "../../shared/logger";
import { AppError } from "../../shared/utils";
import type {
  ResumeAnalysis,
  JDAnalysis,
  RawQuestion,
  InterviewType,
} from "../interview/interview.types";
import type { UserProfile } from "../auth/auth.types";

interface GenerateQuestionsParams {
  technology: string;
  experienceLevel: string;
  interviewType: InterviewType;
  numberOfQuestions: number;
  resumeAnalysis?: ResumeAnalysis;
  jdAnalysis?: JDAnalysis;
  userProfile?: UserProfile;
}

export const generateQuestions = async (params: GenerateQuestionsParams): Promise<RawQuestion[]> => {
  logger.info("[question-generator] generating questions", {
    technology: params.technology,
    numberOfQuestions: params.numberOfQuestions,
    hasResume: Boolean(params.resumeAnalysis),
    hasJD: Boolean(params.jdAnalysis),
    hasUserProfile: Boolean(params.userProfile),
  });

  const prompt = buildQuestionGeneratorPrompt(params);
  const questions = await aiService.generateJSON<RawQuestion[]>(prompt);

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new AppError(500, "AI failed to generate questions. Please try again.");
  }

  const valid = questions.filter(
    (q) =>
      typeof q.question === "string" &&
      q.question.length > 0 &&
      typeof q.difficulty === "string" &&
      typeof q.category === "string"
  );

  const targetCount = params.numberOfQuestions;

  if (valid.length < targetCount) {
    logger.warn(`[question-generator] only ${valid.length}/${targetCount} valid questions generated`);
  }

  logger.info(`[question-generator] generated ${valid.length} questions`);
  return valid.slice(0, targetCount);
};
