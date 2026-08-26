/**
 * V2 learning roadmap service — AI-generated 4-week roadmap (main topics with subtopics,
 * lesson counts, and lazily-generated quizzes), plus the Week -> Week unlock gate driven by
 * each week's knowledge-check interview.
 */

import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type {
  LearningRoadmapDoc,
  QuizDoc,
  QuizQuestion,
  RoadmapQuiz,
  RoadmapSubtopic,
  RoadmapSummary,
  RoadmapTopic,
  RoadmapWeek,
  SubtopicNotesDoc,
} from '../interfaces/learning-roadmap.interface';
import { generateJson } from '../library/gemini-client';
import { AppError } from '../shared/utils';
import { ensureAdmin } from '../utils/callable-auth';
import {
  learningRoadmapCol,
  learningRoadmapQuizRef,
  learningRoadmapRef,
  learningRoadmapSubtopicNotesRef,
  userRef,
} from '../utils/firestore-refs';
import {
  quizQuestionsSchema,
  roadmapSkeletonSchema,
  subtopicNotesSchema,
} from './learning-roadmap.schema';

const PASS_THRESHOLD = 60;
const DEFAULT_LEVEL = 'Intermediate';
const DEFAULT_DURATION = '4w';

function stripWeekNumberFromTitle(title: string): string {
  return title.replace(/^\s*week\s*\d+\s*[:.\-–—]?\s*/i, '').trim() || title.trim();
}

function computeTopicState(topic: RoadmapTopic): RoadmapTopic {
  const totalItems = topic.subtopics.length + topic.quizzes.length;
  const completedItems =
    topic.subtopics.filter((s) => s.isComplete).length +
    topic.quizzes.filter((q) => q.isComplete).length;
  return {
    ...topic,
    isComplete: totalItems > 0 && completedItems === totalItems,
    completionPercent:
      totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
  };
}

/**
 * Recomputes `unlocked`/`interviewUnlocked`/`isComplete` for every week instead of trusting
 * whatever was last persisted. A week unlocks once the previous week's interview is passed;
 * its own interview unlocks once every topic in the week is complete.
 */
function computeWeekState(weeks: RoadmapWeek[]): RoadmapWeek[] {
  return weeks.map((week, index) => {
    const topics = week.topics.map(computeTopicState);
    return {
      ...week,
      title: stripWeekNumberFromTitle(week.title),
      topics,
      unlocked: index === 0 || weeks[index - 1].interview?.passed === true,
      interviewUnlocked: topics.every((topic) => topic.isComplete),
      isComplete: week.interview?.passed === true,
    };
  });
}

function countTopics(weeks: RoadmapWeek[]): number {
  return weeks.reduce((acc, week) => acc + week.topics.length, 0);
}

/** Mirrors the frontend's computeRoadmapProgress so summaries and full docs never disagree. */
function computeProgressPercent(weeks: RoadmapWeek[]): number {
  let total = 0;
  let completed = 0;
  for (const week of weeks) {
    for (const topic of week.topics) {
      total += topic.subtopics.length + topic.quizzes.length;
      completed += topic.subtopics.filter((s) => s.isComplete).length;
      completed += topic.quizzes.filter(
        (q) => q.isComplete && (q.score ?? 0) >= PASS_THRESHOLD,
      ).length;
    }
  }
  return total > 0 ? Math.round((completed / total) * 100) : 0;
}

function toSummary(
  id: string,
  doc: Omit<LearningRoadmapDoc, 'id'>,
  activeId: string | null,
): RoadmapSummary {
  return {
    id,
    technology: doc.technology,
    level: doc.level || DEFAULT_LEVEL,
    duration: doc.duration || DEFAULT_DURATION,
    weeksCount: doc.weeks.length,
    topicsCount: countTopics(doc.weeks),
    progressPercent: computeProgressPercent(doc.weeks),
    isActive: id === activeId,
    updatedAt: doc.updatedAt,
  };
}

function findSubtopic(
  doc: LearningRoadmapDoc,
  subtopicId: string,
): { week: RoadmapWeek; topic: RoadmapTopic; subtopic: RoadmapSubtopic } | null {
  for (const week of doc.weeks) {
    for (const topic of week.topics) {
      const subtopic = topic.subtopics.find((s) => s.id === subtopicId);
      if (subtopic) return { week, topic, subtopic };
    }
  }
  return null;
}

function findQuiz(
  doc: LearningRoadmapDoc,
  quizId: string,
): { week: RoadmapWeek; topic: RoadmapTopic; quiz: RoadmapQuiz } | null {
  for (const week of doc.weeks) {
    for (const topic of week.topics) {
      const quiz = topic.quizzes.find((q) => q.id === quizId);
      if (quiz) return { week, topic, quiz };
    }
  }
  return null;
}

/** Fetches a specific roadmap doc owned by `uid`, throwing 404 if missing. */
async function fetchRoadmapDoc(
  db: Firestore,
  uid: string,
  roadmapId: string,
): Promise<{ ref: DocumentReference; doc: LearningRoadmapDoc }> {
  const ref = learningRoadmapRef(db, uid, roadmapId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new AppError(404, 'Learning roadmap not found.');
  }
  const data = snap.data() as Omit<LearningRoadmapDoc, 'id'>;
  return { ref, doc: { id: roadmapId, ...data } };
}

/**
 * Generates a brand-new 4-week roadmap for a technology and makes it the user's active
 * roadmap. Users can hold any number of roadmaps at once, but never two for the same
 * technology (case-insensitive) — if one already exists, it's activated and returned as-is
 * instead of generating (and paying for) a duplicate.
 */
export async function generateRoadmap(
  uid: string,
  technology: string,
  level: string = DEFAULT_LEVEL,
): Promise<{ roadmap: LearningRoadmapDoc; reused: boolean }> {
  const db = ensureAdmin();

  const trimmedTechnology = technology.trim();
  if (!trimmedTechnology) {
    throw new AppError(400, 'technology is required.');
  }

  const existingSnapshot = await learningRoadmapCol(db, uid).get();
  const existingDoc = existingSnapshot.docs.find((docSnap) => {
    const existingTechnology = (docSnap.data() as { technology?: string }).technology;
    return existingTechnology?.trim().toLowerCase() === trimmedTechnology.toLowerCase();
  });
  if (existingDoc) {
    await userRef(db, uid).update({ activeLearningRoadmapId: existingDoc.id });
    const data = existingDoc.data() as Omit<LearningRoadmapDoc, 'id'>;
    return {
      roadmap: { id: existingDoc.id, ...data, weeks: computeWeekState(data.weeks) },
      reused: true,
    };
  }

  const raw = await generateJson<{ weeks: unknown }>({
    systemInstruction:
      `Create a 4-week interview-prep learning roadmap for someone learning "${trimmedTechnology}" ` +
      'from the basics toward job-interview readiness. Split the plan into EXACTLY 4 weeks, ordered ' +
      'from foundational to advanced: week 1 = fundamentals, week 2 = advanced/core concepts, week 3 ' +
      '= ecosystem/tooling and performance/best practices, week 4 = system design and interview ' +
      'preparation. Each week title is the theme only (e.g. "Angular Fundamentals"), never include ' +
      '"Week 1" or a week number in the title. Each week has 7-10 main topics, each covering a distinct concept area, ordered ' +
      'from foundational to advanced within the week, so the week has real breadth and fully covers ' +
      'that stage of the technology. Each topic needs: a short name, a one-sentence description, ' +
      '7-10 subtopic names, a realistic lessonsCount, and 0-4 quizzes (each quiz just a title and a ' +
      'questionCount between 10 and 15 — do NOT write the actual quiz questions here). Respond ONLY ' +
      'with JSON: { "weeks": [ { "weekNumber": number, "title": string, "topics": [ { "name": ' +
      'string, "description": string, "subtopics": string[], "lessonsCount": number, "quizzes": [ { ' +
      '"title": string, "questionCount": number } ] } ] } ] }.',
    userPrompt: JSON.stringify({ technology: trimmedTechnology }),
    maxOutputTokens: 8192,
  });

  const parsed = roadmapSkeletonSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      502,
      `Invalid roadmap from Gemini: ${parsed.error.message}`,
    );
  }

  const sortedWeeks = [...parsed.data.weeks].sort(
    (a, b) => a.weekNumber - b.weekNumber,
  );
  const weeks: RoadmapWeek[] = sortedWeeks.map((week, weekIndex) => {
    const weekNumber = weekIndex + 1;
    const topics: RoadmapTopic[] = week.topics.map((topic, topicIndex) => {
      const topicId = `w${weekNumber}-t${topicIndex + 1}`;
      const subtopics: RoadmapSubtopic[] = topic.subtopics.map(
        (name, subIndex) => ({
          id: `${topicId}-s${subIndex + 1}`,
          name,
          isComplete: false,
        }),
      );
      const quizzes: RoadmapQuiz[] = topic.quizzes.map((quiz, quizIndex) => ({
        id: `${topicId}-q${quizIndex + 1}`,
        title: quiz.title,
        questionCount: quiz.questionCount,
        isComplete: false,
      }));
      return {
        id: topicId,
        name: topic.name,
        description: topic.description,
        subtopics,
        topicsCount: subtopics.length,
        lessonsCount: topic.lessonsCount,
        quizzes,
        isComplete: false,
        completionPercent: 0,
      };
    });
    return {
      weekNumber,
      title: stripWeekNumberFromTitle(week.title),
      unlocked: weekNumber === 1,
      isComplete: false,
      interviewUnlocked: false,
      topics,
    };
  });

  const ref = learningRoadmapCol(db, uid).doc();
  await ref.set({
    technology: trimmedTechnology,
    level: level.trim() || DEFAULT_LEVEL,
    duration: DEFAULT_DURATION,
    weeks,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  } as never);

  await userRef(db, uid).update({ activeLearningRoadmapId: ref.id });

  const saved = await ref.get();
  const data = saved.data() as Omit<LearningRoadmapDoc, 'id'>;
  return {
    roadmap: { id: ref.id, ...data, weeks: computeWeekState(data.weeks) },
    reused: false,
  };
}

/** Lists every roadmap the user owns (lightweight summaries) for the "YOUR ROADMAPS" list. */
export async function listRoadmaps(uid: string): Promise<RoadmapSummary[]> {
  const db = ensureAdmin();
  const [snapshot, userSnap] = await Promise.all([
    learningRoadmapCol(db, uid).orderBy('updatedAt', 'desc').get(),
    userRef(db, uid).get(),
  ]);
  const activeId = userSnap.data()?.activeLearningRoadmapId ?? null;
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data() as Omit<LearningRoadmapDoc, 'id'>;
    return toSummary(docSnap.id, data, activeId);
  });
}

/**
 * Returns the user's active roadmap (by `activeLearningRoadmapId`). If the pointer is missing
 * or stale, falls back to the most recently updated roadmap and self-heals the pointer. Throws
 * 404 only when the user has no roadmaps at all.
 */
export async function getActiveRoadmap(uid: string): Promise<LearningRoadmapDoc> {
  const db = ensureAdmin();
  const userSnap = await userRef(db, uid).get();
  const activeId = userSnap.data()?.activeLearningRoadmapId;

  if (activeId) {
    const snap = await learningRoadmapRef(db, uid, activeId).get();
    if (snap.exists) {
      const data = snap.data() as Omit<LearningRoadmapDoc, 'id'>;
      return { id: activeId, ...data, weeks: computeWeekState(data.weeks) };
    }
  }

  const fallbackSnapshot = await learningRoadmapCol(db, uid)
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get();
  const fallbackDoc = fallbackSnapshot.docs[0];
  if (!fallbackDoc) {
    throw new AppError(404, 'No learning roadmap found for this account.');
  }

  await userRef(db, uid)
    .update({ activeLearningRoadmapId: fallbackDoc.id })
    .catch(() => undefined);

  const data = fallbackDoc.data() as Omit<LearningRoadmapDoc, 'id'>;
  return { id: fallbackDoc.id, ...data, weeks: computeWeekState(data.weeks) };
}

/** Fetches one specific roadmap by id, 404s if it doesn't exist for this user. */
export async function getRoadmapById(
  uid: string,
  roadmapId: string,
): Promise<LearningRoadmapDoc> {
  const db = ensureAdmin();
  const { doc } = await fetchRoadmapDoc(db, uid, roadmapId);
  return { ...doc, weeks: computeWeekState(doc.weeks) };
}

/** Switches which roadmap is "active" / "current skill" for the user. */
export async function activateRoadmap(
  uid: string,
  roadmapId: string,
): Promise<LearningRoadmapDoc> {
  const db = ensureAdmin();
  const { doc } = await fetchRoadmapDoc(db, uid, roadmapId);
  await userRef(db, uid).update({ activeLearningRoadmapId: roadmapId });
  return { ...doc, weeks: computeWeekState(doc.weeks) };
}

/**
 * Returns cached AI notes for a single subtopic, generating + caching it on demand the first
 * time the user opens it. Each subtopic is its own Gemini call, which keeps notes long and
 * detailed without hitting output token limits, and keeps cost/latency bounded to what the
 * user actually visits.
 */
export async function getOrGenerateSubtopicNotes(
  uid: string,
  roadmapId: string,
  subtopicId: string,
): Promise<SubtopicNotesDoc> {
  const db = ensureAdmin();
  const { doc: roadmap } = await fetchRoadmapDoc(db, uid, roadmapId);
  const found = findSubtopic(roadmap, subtopicId);
  if (!found) {
    throw new AppError(404, 'Subtopic not found in your learning roadmap.');
  }

  const notesRef = learningRoadmapSubtopicNotesRef(db, uid, roadmapId, subtopicId);
  const cached = await notesRef.get();
  if (cached.exists) {
    return cached.data() as SubtopicNotesDoc;
  }

  const { topic, subtopic } = found;
  const technology = roadmap.technology;

  const raw = await generateJson<{ summary?: unknown; sections?: unknown; keyTakeaways?: unknown }>({
    systemInstruction:
      `Write in-depth, interview-ready study notes for the subtopic "${subtopic.name}", part of ` +
      `the main topic "${topic.name}" while learning "${technology}". The notes must be ` +
      'comprehensive enough to fully prepare for interview questions on it: explain the concept ' +
      'thoroughly from first principles, include concrete examples or short code snippets where ' +
      'relevant, and call out common pitfalls or angles interviewers probe. Respond ONLY with JSON: ' +
      '{ "summary": string, "sections": [ { "heading": string, "content": string, "bullets": ' +
      'string[] (optional) } ], "keyTakeaways": string[] }. Keep the notes around 800-1200 words ' +
      'across 4-6 sections, covering the subtopic thoroughly.',
    userPrompt: JSON.stringify({ subtopic: subtopic.name, topic: topic.name, technology }),
    maxOutputTokens: 4096,
  });

  const parsed = subtopicNotesSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      502,
      `Invalid subtopic notes from Gemini: ${parsed.error.message}`,
    );
  }

  const doc: SubtopicNotesDoc = {
    subtopicId,
    subtopicName: subtopic.name,
    topicId: topic.id,
    topicName: topic.name,
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
 * Marks a subtopic as read/done. The subtopic's week must already be unlocked.
 */
export async function markSubtopicComplete(
  uid: string,
  roadmapId: string,
  subtopicId: string,
): Promise<LearningRoadmapDoc> {
  const db = ensureAdmin();
  const { ref, doc } = await fetchRoadmapDoc(db, uid, roadmapId);
  const found = findSubtopic(doc, subtopicId);
  if (!found) {
    throw new AppError(404, 'Subtopic not found in your learning roadmap.');
  }

  const computedWeek = computeWeekState(doc.weeks).find(
    (w) => w.weekNumber === found.week.weekNumber,
  );
  if (!computedWeek?.unlocked) {
    throw new AppError(403, 'This week is locked.');
  }

  const weeks = doc.weeks.map((week) => {
    if (week.weekNumber !== found.week.weekNumber) return week;
    return {
      ...week,
      topics: week.topics.map((topic) => {
        if (topic.id !== found.topic.id) return topic;
        const subtopics = topic.subtopics.map((s) =>
          s.id === subtopicId ? { ...s, isComplete: true } : s,
        );
        return computeTopicState({ ...topic, subtopics });
      }),
    };
  });

  await ref.update({ weeks, updatedAt: FieldValue.serverTimestamp() });
  return { ...doc, weeks: computeWeekState(weeks) };
}

/**
 * Returns cached quiz questions, generating + caching them on first request.
 */
export async function getOrGenerateQuiz(
  uid: string,
  roadmapId: string,
  quizId: string,
): Promise<QuizDoc> {
  const db = ensureAdmin();
  const { doc: roadmap } = await fetchRoadmapDoc(db, uid, roadmapId);
  const found = findQuiz(roadmap, quizId);
  if (!found) {
    throw new AppError(404, 'Quiz not found in your learning roadmap.');
  }

  const quizRef = learningRoadmapQuizRef(db, uid, roadmapId, quizId);
  const cached = await quizRef.get();
  if (cached.exists) {
    return cached.data() as QuizDoc;
  }

  const { topic, quiz } = found;
  const technology = roadmap.technology;

  const raw = await generateJson<{ questions?: unknown }>({
    systemInstruction:
      `Write a multiple-choice quiz titled "${quiz.title}" for the topic "${topic.name}", part of ` +
      `learning "${technology}". Generate exactly ${quiz.questionCount} questions. Each question ` +
      'needs 4 distinct answer options and one correctAnswer that matches one of the options exactly. ' +
      'Generate a fresh set of questions; vary difficulty and wording so retries do not feel identical. ' +
      'Respond ONLY with JSON: { "questions": [ { "question": string, "options": string[4], ' +
      '"correctAnswer": string } ] }.',
    userPrompt: JSON.stringify({
      topic: topic.name,
      technology,
      questionCount: quiz.questionCount,
    }),
    maxOutputTokens: 4096,
  });

  const parsed = quizQuestionsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(502, `Invalid quiz from Gemini: ${parsed.error.message}`);
  }

  const questions: QuizQuestion[] = parsed.data.questions.map((q, index) => ({
    id: `${quizId}-q${index + 1}`,
    question: q.question,
    options: q.options,
    correctAnswer: q.correctAnswer,
  }));

  const doc: QuizDoc = {
    quizId,
    topicId: topic.id,
    topicName: topic.name,
    technology,
    questions,
    createdAt: FieldValue.serverTimestamp() as never,
  };

  await quizRef.set(doc as never);
  return doc;
}

/**
 * Grades a quiz attempt against the cached questions, marks it complete, and rolls the score
 * into the owning topic's completion state. On fail (< PASS_THRESHOLD), the cached quiz doc is
 * deleted so the next open regenerates a fresh question set via Gemini.
 */
export async function submitQuiz(
  uid: string,
  roadmapId: string,
  quizId: string,
  answers: Record<string, string>,
): Promise<{ score: number; roadmap: LearningRoadmapDoc }> {
  const db = ensureAdmin();
  const quizRef = learningRoadmapQuizRef(db, uid, roadmapId, quizId);
  const quizSnap = await quizRef.get();
  if (!quizSnap.exists) {
    throw new AppError(404, 'Quiz not found. Open the quiz before submitting.');
  }
  const quizDoc = quizSnap.data() as QuizDoc;
  const total = quizDoc.questions.length;
  const correct = quizDoc.questions.filter(
    (q) => answers[q.id] === q.correctAnswer,
  ).length;
  const score = total > 0 ? Math.round((correct / total) * 100) : 0;

  const { ref, doc } = await fetchRoadmapDoc(db, uid, roadmapId);
  const found = findQuiz(doc, quizId);
  if (!found) {
    throw new AppError(404, 'Quiz not found in your learning roadmap.');
  }

  const weeks = doc.weeks.map((week) => {
    if (week.weekNumber !== found.week.weekNumber) return week;
    return {
      ...week,
      topics: week.topics.map((topic) => {
        if (topic.id !== found.topic.id) return topic;
        const quizzes = topic.quizzes.map((q) =>
          q.id === quizId ? { ...q, isComplete: true, score } : q,
        );
        return computeTopicState({ ...topic, quizzes });
      }),
    };
  });

  await ref.update({ weeks, updatedAt: FieldValue.serverTimestamp() });

  // Failed attempts clear the question cache so retakes get a new Gemini-generated set.
  // Passed quizzes keep their cache so reopen still shows the same questions / results.
  if (score < PASS_THRESHOLD) {
    await quizRef.delete();
  }

  return { score, roadmap: { ...doc, weeks: computeWeekState(weeks) } };
}

/** Parses `learning-roadmap:{roadmapId}:week{W}` — the tag interviews use to link back here. */
export function parseLearningRoadmapActivityId(
  sourceRoadmapActivityId: string | undefined,
): { roadmapId: string; week: number } | null {
  if (!sourceRoadmapActivityId) return null;
  const match = /^learning-roadmap:([^:]+):week(\d+)$/.exec(sourceRoadmapActivityId);
  if (!match) return null;
  return { roadmapId: match[1], week: Number(match[2]) };
}

/**
 * Applies a completed knowledge-check interview's score to its roadmap week.
 * Best-effort — callers should wrap in `.catch()` (same pattern as generateReport /
 * checkAchievements in interview.service.ts).
 *
 * Pass (score >= 60%): the week is marked complete and stamped with `passedAt`, which unlocks
 * the next week immediately. Fail: the interview result is recorded but the week's topics are
 * left as the user completed them, so they can retake the interview without redoing content.
 */
export async function evaluateWeekInterview(
  uid: string,
  roadmapId: string,
  week: number,
  overallScore: number,
  interviewId: string,
): Promise<void> {
  const db = ensureAdmin();
  const ref = learningRoadmapRef(db, uid, roadmapId);
  const snap = await ref.get();
  if (!snap.exists) return;

  const data = snap.data() as Omit<LearningRoadmapDoc, 'id'>;
  const weekIndex = data.weeks.findIndex((w) => w.weekNumber === week);
  if (weekIndex === -1) return;

  const wasAlreadyPassed = data.weeks[weekIndex].interview?.passed === true;
  const passed = overallScore >= PASS_THRESHOLD;
  const weeks = data.weeks.map((w, index) => {
    if (index !== weekIndex) return w;
    return {
      ...w,
      interview: {
        interviewId,
        score: overallScore,
        passed,
        passedAt: passed ? Timestamp.now() : null,
      },
    };
  });

  await ref.update({ weeks, updatedAt: FieldValue.serverTimestamp() });

  // First-time pass only — retakes shouldn't inflate the achievement counter.
  if (passed && !wasAlreadyPassed) {
    await userRef(db, uid).update({
      'stats.roadmapWeeksCompleted': FieldValue.increment(1),
    });
  }
}
