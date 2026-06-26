import { z } from "zod";
import { DIFFICULTY_LEVELS, INTERVIEW_TYPES } from "../../shared/constants";

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
  difficultyLevel: z.enum(DIFFICULTY_LEVELS, {
    message: `difficultyLevel must be one of: ${DIFFICULTY_LEVELS.join(", ")}`,
  }),
  interviewType: z.enum(INTERVIEW_TYPES, {
    message: `interviewType must be one of: ${INTERVIEW_TYPES.join(", ")}`,
  }),
  durationMinutes: z
    .number()
    .int("durationMinutes must be a whole number")
    .positive("durationMinutes must be greater than 0"),
  questionCount: z
    .number()
    .int("questionCount must be a whole number")
    .positive("questionCount must be greater than 0"),
});

export const interviewIdParamSchema = z.object({
  id: z.string().min(1, "Interview ID is required"),
});

export type CreateInterviewInput = z.infer<typeof createInterviewSchema>;
export type InterviewIdParams = z.infer<typeof interviewIdParamSchema>;
