import { z } from "zod";
import { InterviewType, InterviewStatus } from "./interview.types";
import { PAGINATION } from "../../shared/constants";

export const createInterviewSchema = z.object({
  role: z
    .string()
    .min(2, "Role must be at least 2 characters")
    .max(100, "Role is too long")
    .trim(),
  experience: z
    .string()
    .min(1, "Experience is required")
    .max(50, "Experience value is too long")
    .trim(),
  type: z.nativeEnum(InterviewType, {
    message: "Type must be one of: technical, behavioral, mixed",
  }),
});

export const submitAnswerSchema = z.object({
  questionId: z.string().min(1, "questionId is required"),
  answer: z
    .string()
    .min(1, "Answer cannot be empty")
    .max(5000, "Answer is too long (max 5000 characters)")
    .trim(),
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

export type CreateInterviewInput = z.infer<typeof createInterviewSchema>;
export type SubmitAnswerInput = z.infer<typeof submitAnswerSchema>;
export type ListInterviewsQuery = z.infer<typeof listInterviewsQuerySchema>;
