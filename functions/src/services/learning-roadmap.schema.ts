/**
 * Zod schemas for AI-generated learning roadmap content (4-week skeleton,
 * per-subtopic notes, quiz questions).
 */

import { z } from 'zod';

export const roadmapSkeletonSchema = z.object({
  weeks: z
    .array(
      z.object({
        weekNumber: z.number().int().min(1).max(4),
        title: z.string().min(1),
        topics: z
          .array(
            z.object({
              name: z.string().min(1),
              description: z.string().min(1),
              subtopics: z.array(z.string().min(1)).min(1).max(10),
              lessonsCount: z.number().int().min(1).max(60),
              quizzes: z
                .array(
                  z.object({
                    title: z.string().min(1),
                    questionCount: z.number().int().min(10).max(15),
                  }),
                )
                .min(0)
                .max(4),
            }),
          )
          .min(1)
          .max(10),
      }),
    )
    .length(4),
});

export type RoadmapSkeletonParsed = z.infer<typeof roadmapSkeletonSchema>;

/** One Gemini call now returns notes for exactly one subtopic (generated on demand). */
export const subtopicNotesSchema = z.object({
  summary: z.string().min(1),
  sections: z
    .array(
      z.object({
        heading: z.string().min(1),
        content: z.string().min(1),
        bullets: z.array(z.string().min(1)).optional(),
      }),
    )
    .min(1)
    .max(15),
  keyTakeaways: z.array(z.string().min(1)).min(1),
});

export type SubtopicNotesParsed = z.infer<typeof subtopicNotesSchema>;

export const quizQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        options: z.array(z.string().min(1)).min(2).max(10),
        correctAnswer: z.string().min(1),
      }),
    )
    .min(1)
    .max(25),
});

export type QuizQuestionsParsed = z.infer<typeof quizQuestionsSchema>;
