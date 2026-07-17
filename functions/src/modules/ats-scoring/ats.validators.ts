import { z } from "zod";

export const analyzeResumeSchema = z
  .object({
    resumeText: z
      .string()
      .trim()
      .min(100, "Resume text is too short (min 100 characters)")
      .max(15_000, "Resume text is too long (max 15,000 characters)")
      .optional(),

    parsedResume: z
      .object({
        skills: z.array(z.string()).optional(),
        experience: z
          .array(
            z.object({
              title: z.string(),
              company: z.string(),
              duration: z.string(),
              description: z.string(),
            }),
          )
          .optional(),
        projects: z
          .array(
            z.object({
              name: z.string(),
              description: z.string(),
            }),
          )
          .optional(),
        education: z
          .array(
            z.object({
              degree: z.string(),
              university: z.string(),
              year: z.string(),
            }),
          )
          .optional(),
      })
      .optional(),

    jobDescription: z
      .string()
      .trim()
      .min(100, "Job description is too short (min 100 characters)")
      .max(15_000, "Job description is too long (max 15,000 characters)")
      .optional(),

    targetRole: z
      .string()
      .trim()
      .min(1, "Target role cannot be empty")
      .optional(),
  })
  .refine(
    (data) => {
      const hasResume = !!(data.resumeText || data.parsedResume);
      const hasComparison = !!(data.jobDescription || data.targetRole);

      return hasResume && hasComparison;
    },
    {
      message:
        "You must provide either a jobDescription or a targetRole, and either resumeText or parsedResume.",
      path: ["resumeText"],
    },
  );

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const analysisIdParamSchema = z.object({
  id: z.string().trim().min(1, "Analysis ID is required"),
});
