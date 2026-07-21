import { z } from "zod";
import { DIFFICULTY_LEVELS } from "../../shared/constants";

export const createInterviewSchema = z.object({
  domain: z
    .string()
    .min(2, "Domain must be at least 2 characters")
    .max(100, "Domain is too long")
    .trim(),
  category: z
    .string()
    .min(2, "Category must be at least 2 characters")
    .max(100, "Category is too long")
    .trim(),
  specification: z
    .string()
    .min(2, "Specification must be at least 2 characters")
    .max(100, "Specification is too long")
    .trim(),
  targetRole: z
    .string()
    .min(2, "Target role must be at least 2 characters")
    .max(100, "Target role is too long")
    .trim(),
  experienceLevel: z
    .string()
    .min(1, "Experience level is required")
    .max(50, "Experience level is too long")
    .trim(),
  difficultyLevel: z.enum(DIFFICULTY_LEVELS, {
    message: `difficultyLevel must be one of: ${DIFFICULTY_LEVELS.join(", ")}`,
  }),
  interviewType: z
    .string()
    .min(1, "interviewType is required")
    .max(100, "interviewType is too long")
    .trim(),
  durationMinutes: z
    .number()
    .int("durationMinutes must be a whole number")
    .positive("durationMinutes must be greater than 0"),
});

export const interviewIdParamSchema = z.object({
  id: z.string().min(1, "Interview ID is required"),
});

export const listInterviewsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  startAfter: z.string().min(1).optional(),
});

export const resumePdfSchema = z.object({
  html: z
    .string()
    .min(1, "html is required")
    .max(500_000, "html payload is too large"),
  fileName: z
    .string()
    .min(1, "fileName is required")
    .max(200, "fileName is too long")
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "fileName must contain only letters, numbers, hyphens, and underscores"
    ),
});

export type CreateInterviewInput = z.infer<typeof createInterviewSchema>;
export type InterviewIdParams = z.infer<typeof interviewIdParamSchema>;
export type ListInterviewsQuery = z.infer<typeof listInterviewsQuerySchema>;
export type ResumePdfInput = z.infer<typeof resumePdfSchema>;
