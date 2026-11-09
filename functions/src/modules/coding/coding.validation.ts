import { z } from "zod";
import { ALL_CODING_LANGUAGES } from "./coding.languages";

export const codingLanguageSchema = z.enum(
  ALL_CODING_LANGUAGES as [string, ...string[]]
);

export const runCodeSchema = z.object({
  problemId: z.string().min(1).max(128),
  language: codingLanguageSchema,
  sourceCode: z.string().min(1).max(65536),
  customInput: z.string().max(8192).optional(),
});

/** DSA: language + sourceCode. Non-DSA: answerText (written response). */
export const submitCodeSchema = z
  .object({
    problemId: z.string().min(1).max(128),
    language: codingLanguageSchema.optional(),
    sourceCode: z.string().max(65536).optional(),
    answerText: z.string().trim().min(1).max(32768).optional(),
  })
  .superRefine((value, ctx) => {
    const hasCode = Boolean(value.sourceCode?.trim());
    const hasAnswer = Boolean(value.answerText?.trim());
    if (!hasCode && !hasAnswer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide sourceCode (DSA) or answerText (non-DSA assessment)",
      });
    }
    if (hasCode && !value.language) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "language is required when submitting sourceCode",
        path: ["language"],
      });
    }
  });

export const generateCodingProblemSchema = z.object({
  /** Ignored — generation is always Easy. Kept optional for backward compatibility. */
  difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  focusTopic: z.string().trim().max(64).optional(),
});

export type RunCodeInput = z.infer<typeof runCodeSchema>;
export type SubmitCodeInput = z.infer<typeof submitCodeSchema>;
export type GenerateCodingProblemInput = z.infer<typeof generateCodingProblemSchema>;
