/**
 * V2 learning roadmap service — AI-generated Week-1 day-wise topics, per-topic study
 * notes, and the Day → Day unlock gate driven by the linked knowledge-check interview.
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type {
  LearningRoadmapDay,
  LearningRoadmapDoc,
  LearningRoadmapTopic,
  LearningTopicNotesDoc,
} from '../interfaces/learning-roadmap.interface';
import { generateJson } from '../library/gemini-client';
import { AppError } from '../shared/utils';
import { ensureAdmin } from '../utils/callable-auth';
import {
  learningRoadmapRef,
  learningRoadmapTopicNotesRef,
} from '../utils/firestore-refs';
import { topicNotesSchema, week1DaysSchema } from './learning-roadmap.schema';

const PASS_THRESHOLD = 60;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function buildTopicId(day: number, name: string, usedIds: Set<string>): string {
  const base = `day${day}-${slugify(name)}`;
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

/** Calendar-day key (UTC) used to check whether a full day has elapsed since a pass. */
function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A day unlocks the day AFTER its predecessor was passed — not immediately. */
function isUnlockedByPreviousDay(previous: LearningRoadmapDay): boolean {
  if (!previous.passed) return false;
  // Passed before this same-day gate existed (no `passedAt` on record) — grandfather
  // it as unlocked rather than regressing access for users already mid-roadmap.
  if (!previous.passedAt) return true;
  const passedDate = (previous.passedAt as Timestamp).toDate();
  return toDateKey(new Date()) > toDateKey(passedDate);
}

/**
 * Recomputes `unlocked` for every day from the previous day's `passed`/`passedAt`
 * instead of trusting whatever was last persisted — this is what makes the
 * "unlocks the next calendar day" rule work without a scheduled job.
 */
function withComputedUnlock(days: LearningRoadmapDay[]): LearningRoadmapDay[] {
  return days.map((day, index) => {
    if (index === 0) return { ...day, unlocked: true };
    return { ...day, unlocked: isUnlockedByPreviousDay(days[index - 1]) };
  });
}

/**
 * `evaluateDayInterview` now always resets a failed day's topics to incomplete.
 * Roadmaps saved before that fix can still be sitting in a stale state — failed
 * (`passed: false`) but with every topic still marked `completed: true` — which
 * would let the user jump straight back into a retry interview without
 * revisiting the material. Self-heals that stale shape the next time the
 * roadmap is read, persisting the fix so it only needs to run once.
 */
function needsStaleFailNormalization(day: LearningRoadmapDay): boolean {
  return day.passed === false && day.topics.some((topic) => topic.completed);
}

async function normalizeStaleFailedDays(
  ref: ReturnType<typeof learningRoadmapRef>,
  doc: LearningRoadmapDoc,
): Promise<LearningRoadmapDay[]> {
  if (!doc.days.some(needsStaleFailNormalization)) {
    return doc.days;
  }

  const days = doc.days.map((day) => {
    if (!needsStaleFailNormalization(day)) return day;
    return {
      ...day,
      completed: false,
      passedAt: null,
      topics: day.topics.map((topic) => ({ ...topic, completed: false })),
    };
  });

  await ref.update({ days, updatedAt: FieldValue.serverTimestamp() });
  return days;
}

/**
 * Generates (or returns the existing) Week-1 roadmap for a technology.
 * Write-once — re-calling with a different technology after one exists returns
 * the original roadmap, mirroring the resume onboarding plan's write-once rule.
 */
export async function generateWeek1Roadmap(
  uid: string,
  technology: string,
): Promise<LearningRoadmapDoc> {
  const db = ensureAdmin();
  const ref = learningRoadmapRef(db, uid);
  const existing = await ref.get();
  if (existing.exists) {
    const doc = existing.data() as LearningRoadmapDoc;
    const days = await normalizeStaleFailedDays(ref, doc);
    return { ...doc, days: withComputedUnlock(days) };
  }

  const trimmedTechnology = technology.trim();
  if (!trimmedTechnology) {
    throw new AppError(400, 'technology is required.');
  }

  const raw = await generateJson<{ days: unknown }>({
    systemInstruction:
      `Create a Week 1 study plan for someone learning "${trimmedTechnology}" from the basics ` +
      'toward interview readiness. Split the week into 5 days (day 1-5). For each day, list ONLY ' +
      '3-5 important topic NAMES (no descriptions, no sentences) that should be studied that day, ' +
      'ordered from foundational to more advanced across the week. ' +
      'Respond ONLY with JSON: { "days": [ { "day": number, "topics": string[] } ] }.',
    userPrompt: JSON.stringify({ technology: trimmedTechnology }),
    // Just a handful of short topic names per day — no need for the default 4096 ceiling.
    maxOutputTokens: 1024,
  });

  const parsed = week1DaysSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      502,
      `Invalid Week 1 roadmap from Gemini: ${parsed.error.message}`,
    );
  }

  const usedIds = new Set<string>();
  const sortedDays = [...parsed.data.days].sort((a, b) => a.day - b.day);
  const days: LearningRoadmapDay[] = sortedDays.map((day, index) => {
    const topics: LearningRoadmapTopic[] = day.topics.map((name) => ({
      id: buildTopicId(day.day, name, usedIds),
      name,
      completed: false,
    }));
    return {
      day: day.day,
      topics,
      unlocked: index === 0,
      completed: false,
    };
  });

  await ref.set({
    technology: trimmedTechnology,
    weekNumber: 1,
    days,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  } as never);

  const saved = await ref.get();
  const doc = saved.data() as LearningRoadmapDoc;
  return { ...doc, days: withComputedUnlock(doc.days) };
}

export async function getActiveLearningRoadmap(
  uid: string,
): Promise<LearningRoadmapDoc> {
  const db = ensureAdmin();
  const ref = learningRoadmapRef(db, uid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new AppError(404, 'No learning roadmap found for this account.');
  }
  const doc = snap.data() as LearningRoadmapDoc;
  const days = await normalizeStaleFailedDays(ref, doc);
  return { ...doc, days: withComputedUnlock(days) };
}

function findTopic(
  doc: LearningRoadmapDoc,
  topicId: string,
): { day: LearningRoadmapDay; topic: LearningRoadmapTopic } | null {
  for (const day of doc.days) {
    const topic = day.topics.find((t) => t.id === topicId);
    if (topic) return { day, topic };
  }
  return null;
}

/**
 * Returns cached AI notes for a topic, generating + caching them on first request.
 */
export async function getOrGenerateTopicNotes(
  uid: string,
  topicId: string,
): Promise<LearningTopicNotesDoc> {
  const db = ensureAdmin();
  const roadmapSnap = await learningRoadmapRef(db, uid).get();
  if (!roadmapSnap.exists) {
    throw new AppError(404, 'No learning roadmap found for this account.');
  }
  const roadmap = roadmapSnap.data() as LearningRoadmapDoc;
  const found = findTopic(roadmap, topicId);
  if (!found) {
    throw new AppError(404, 'Topic not found in your learning roadmap.');
  }

  const notesRef = learningRoadmapTopicNotesRef(db, uid, topicId);
  const cached = await notesRef.get();
  if (cached.exists) {
    return cached.data() as LearningTopicNotesDoc;
  }

  const topicName = found.topic.name;
  const technology = roadmap.technology;

  const raw = await generateJson<{
    summary?: unknown;
    sections?: unknown;
    keyTakeaways?: unknown;
  }>({
    systemInstruction:
      `Write detailed, beginner-friendly study notes for the topic "${topicName}", part of learning ` +
      `"${technology}". The notes should be thorough enough to prepare for an interview question on ` +
      'this topic. Respond ONLY with JSON: { "summary": string, "sections": [ { "heading": string, ' +
      '"content": string, "bullets": string[] (optional) } ], "keyTakeaways": string[] }. ' +
      'Keep the total length around 400-600 words across 2-4 sections.',
    userPrompt: JSON.stringify({ topic: topicName, technology }),
    // ~400-600 words of structured JSON comfortably fits well under the default 4096 ceiling.
    maxOutputTokens: 2048,
  });

  const parsed = topicNotesSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      502,
      `Invalid topic notes from Gemini: ${parsed.error.message}`,
    );
  }

  const doc: LearningTopicNotesDoc = {
    topicId,
    topicName,
    technology,
    summary: parsed.data.summary,
    sections: parsed.data.sections,
    keyTakeaways: parsed.data.keyTakeaways,
    createdAt: FieldValue.serverTimestamp() as never,
  };

  await notesRef.set(doc as never);
  return doc;
}

/**
 * Marks a topic's notes as read. The topic's day must already be unlocked.
 */
export async function markTopicComplete(
  uid: string,
  topicId: string,
): Promise<LearningRoadmapDoc> {
  const db = ensureAdmin();
  const ref = learningRoadmapRef(db, uid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new AppError(404, 'No learning roadmap found for this account.');
  }
  const raw = snap.data() as LearningRoadmapDoc;
  const normalizedDays = await normalizeStaleFailedDays(ref, raw);
  const computedDays = withComputedUnlock(normalizedDays);
  const found = findTopic({ ...raw, days: computedDays }, topicId);
  if (!found) {
    throw new AppError(404, 'Topic not found in your learning roadmap.');
  }
  if (!found.day.unlocked) {
    throw new AppError(403, 'This day is locked.');
  }

  const days = normalizedDays.map((day) =>
    day.day !== found.day.day
      ? day
      : {
          ...day,
          topics: day.topics.map((topic) =>
            topic.id === topicId ? { ...topic, completed: true } : topic,
          ),
        },
  );

  await ref.update({ days, updatedAt: FieldValue.serverTimestamp() });
  return { ...raw, days: withComputedUnlock(days) };
}

/** Parses `learning-roadmap:week{W}:day{D}` — the tag interviews use to link back here. */
export function parseLearningRoadmapActivityId(
  sourceRoadmapActivityId: string | undefined,
): { week: number; day: number } | null {
  if (!sourceRoadmapActivityId) return null;
  const match = /^learning-roadmap:week(\d+):day(\d+)$/.exec(
    sourceRoadmapActivityId,
  );
  if (!match) return null;
  return { week: Number(match[1]), day: Number(match[2]) };
}

/**
 * Applies a completed knowledge-check interview's score to its roadmap day.
 * Best-effort — callers should wrap in `.catch()` (same pattern as
 * generateReport / checkAchievements in interview.service.ts).
 *
 * - Pass (score >= 60%): the day is marked complete and stamped with
 *   `passedAt`. The next day does NOT unlock immediately — `withComputedUnlock`
 *   only unlocks it once the calendar date has moved past `passedAt`, i.e.
 *   "tomorrow".
 * - Fail (score < 60%): the day stays locked-in-progress. All of that day's
 *   topics are reset to incomplete so the user has to work back through them
 *   before they can retake the knowledge check.
 */
export async function evaluateDayInterview(
  uid: string,
  week: number,
  day: number,
  overallScore: number,
  interviewId: string,
): Promise<void> {
  const db = ensureAdmin();
  const ref = learningRoadmapRef(db, uid);
  const snap = await ref.get();
  if (!snap.exists) return;

  const roadmap = snap.data() as LearningRoadmapDoc;
  if (roadmap.weekNumber !== week) return;

  const dayIndex = roadmap.days.findIndex((d) => d.day === day);
  if (dayIndex === -1) return;

  const passed = overallScore >= PASS_THRESHOLD;
  const days = roadmap.days.map((d, index) => {
    if (index !== dayIndex) return d;

    if (passed) {
      return {
        ...d,
        completed: true,
        score: overallScore,
        passed: true,
        interviewId,
        passedAt: Timestamp.now(),
      };
    }

    // Failed — require the topics to be revisited before the next attempt.
    return {
      ...d,
      completed: false,
      score: overallScore,
      passed: false,
      interviewId,
      passedAt: null,
      topics: d.topics.map((topic) => ({ ...topic, completed: false })),
    };
  });

  await ref.update({ days, updatedAt: FieldValue.serverTimestamp() });
}
