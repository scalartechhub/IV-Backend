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

export const submitCodeSchema = z.object({
  problemId: z.string().min(1).max(128),
  language: codingLanguageSchema,
  sourceCode: z.string().min(1).max(65536),
});

export type RunCodeInput = z.infer<typeof runCodeSchema>;
export type SubmitCodeInput = z.infer<typeof submitCodeSchema>;
