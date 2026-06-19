import { z } from "zod";
import { InterviewType } from "./interview.types";
import { QUESTION_DISTRIBUTION } from "../../shared/constants";

const answerItemSchema = z.object({
  questionId: z.string().min(1, "questionId is required"),
  answer: z
    .string()
    .min(1, "Answer cannot be empty")
    .max(5000, "Answer is too long (max 5000 characters)")
    .trim(),
});

export const createInterviewSchema = z.object({
  technology: z
    .string()
    .min(2, "Technology must be at least 2 characters")
    .max(100, "Technology is too long")
    .trim(),
  experienceLevel: z
    .string()
    .min(1, "Experience level is required")
    .max(50, "Experience level is too long")
    .trim(),
  interviewType: z.nativeEnum(InterviewType, {
    message: "interviewType must be one of: technical, hr, mixed",
  }),
});

export const submitAnswerSchema = z.object({
  answers: z
    .array(answerItemSchema)
    .min(1, "At least one answer is required")
    .max(
      QUESTION_DISTRIBUTION.TOTAL,
      `Cannot submit more than ${QUESTION_DISTRIBUTION.TOTAL} answers at once`
    )
    .refine(
      (answers) => new Set(answers.map((a) => a.questionId)).size === answers.length,
      { message: "Each questionId must appear only once in answers" }
    ),
});

export const interviewIdParamSchema = z.object({
  id: z.string().min(1, "Interview ID is required"),
});

export type CreateInterviewInput = z.infer<typeof createInterviewSchema>;
export type SubmitAnswerInput = z.infer<typeof submitAnswerSchema>;
export type InterviewIdParams = z.infer<typeof interviewIdParamSchema>;
