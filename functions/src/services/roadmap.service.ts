/**
 * V2 roadmap service.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { RoadmapDoc, RoadmapWeek } from '../interfaces/roadmap.interface';
import { generateJson } from '../library/gemini-client';
import { AppError } from '../shared/utils';
import { ensureAdmin } from '../utils/callable-auth';
import { roadmapCol, userRef } from '../utils/firestore-refs';

const weeksSchema = z.array(
  z.object({
    weekNumber: z.number(),
    theme: z.string(),
    unlocked: z.boolean(),
    percentComplete: z.number(),
    activities: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        type: z.enum(['video', 'reading', 'practice', 'project', 'interview']),
        estMinutes: z.number(),
        status: z.enum(['pending', 'in_progress', 'done']),
        linkedInterviewId: z.string().optional(),
      }),
    ),
  }),
);

export async function regenerateRoadmap(
  uid: string,
  opts: { targetRole?: string } = {},
): Promise<{ roadmapId: string }> {
  const db = ensureAdmin();
  const userSnap = await userRef(db, uid).get();
  if (!userSnap.exists) throw new AppError(404, 'User not found.');
  const user = userSnap.data()!;
  const targetRole =
    opts.targetRole ?? user.profile?.targetRole ?? 'Software Engineer';

  const raw = await generateJson<{ title?: string; weeks: unknown }>({
    systemInstruction: `Create a 4-week learning roadmap as JSON: { title: string, weeks: RoadmapWeek[] }.
Each week has weekNumber, theme, unlocked (week1 true), percentComplete:0, activities[{id,title,type,estMinutes,status:'pending'}].
Types: video|reading|practice|project|interview. Respond ONLY with JSON.`,
    userPrompt: JSON.stringify({
      targetRole,
      currentRole: user.profile?.currentRole,
      readiness: user.readiness?.score,
    }),
  });

  const weeksParsed = weeksSchema.safeParse(raw.weeks);
  if (!weeksParsed.success) {
    throw new AppError(
      502,
      `Invalid roadmap from Gemini: ${weeksParsed.error.message}`,
    );
  }

  const weeks: RoadmapWeek[] = weeksParsed.data;
  const newRef = roadmapCol(db, uid).doc();

  await db.runTransaction(async (tx) => {
    const active = await tx.get(
      roadmapCol(db, uid).where('isActive', '==', true),
    );
    for (const doc of active.docs) {
      tx.update(doc.ref, { isActive: false });
    }

    const doc: RoadmapDoc = {
      title: raw.title ?? `Your 4-week path to ${targetRole}`,
      targetRole,
      generatedAt: FieldValue.serverTimestamp() as never,
      generatedFrom: 'manual_regenerate',
      isActive: true,
      weeks,
    };
    tx.set(newRef, doc);
  });

  return { roadmapId: newRef.id };
}

export async function getActiveRoadmap(uid: string) {
  const db = ensureAdmin();
  const snap = await roadmapCol(db, uid)
    .where('isActive', '==', true)
    .limit(1)
    .get();
  if (snap.empty) throw new AppError(404, 'No active roadmap found.');
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}
