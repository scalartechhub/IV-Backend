/**
 * Zod schemas for AI-generated learning roadmap content (Week-1 topics + topic notes).
 */

import { z } from 'zod';

export const week1DaysSchema = z.object({
  days: z
    .array(
      z.object({
        day: z.number().int().min(1),
        topics: z.array(z.string().min(1)).min(2).max(6),
      }),
    )
    .min(3)
    .max(7),
});

export type Week1DaysParsed = z.infer<typeof week1DaysSchema>;

export const topicNotesSchema = z.object({
  summary: z.string().min(1),
  sections: z
    .array(
      z.object({
        heading: z.string().min(1),
        content: z.string().min(1),
        bullets: z.array(z.string().min(1)).optional(),
      }),
    )
    .min(1),
  keyTakeaways: z.array(z.string().min(1)).min(1),
});

export type TopicNotesParsed = z.infer<typeof topicNotesSchema>;
