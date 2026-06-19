import { z } from "zod";
import { InterviewType, InterviewStatus } from "./interview.types";
import { PAGINATION, QUESTION_DISTRIBUTION } from "../../shared/constants";

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

export const listInterviewsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : PAGINATION.DEFAULT_PAGE))
    .pipe(z.number().int().min(1, "Page must be at least 1")),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : PAGINATION.DEFAULT_LIMIT))
    .pipe(
      z
        .number()
        .int()
        .min(1)
        .max(PAGINATION.MAX_LIMIT, `Limit cannot exceed ${PAGINATION.MAX_LIMIT}`)
    ),
  status: z.nativeEnum(InterviewStatus).optional(),
});

export const interviewIdParamSchema = z.object({
  id: z.string().min(1, "Interview ID is required"),
});

export type CreateInterviewInput = z.infer<typeof createInterviewSchema>;
export type SubmitAnswerInput = z.infer<typeof submitAnswerSchema>;
export type ListInterviewsQuery = z.infer<typeof listInterviewsQuerySchema>;
export type InterviewIdParams = z.infer<typeof interviewIdParamSchema>;
