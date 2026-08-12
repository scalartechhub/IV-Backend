/**
 * V2 learning roadmap service — AI-generated 4-week roadmap (main topics with subtopics,
 * lesson counts, and lazily-generated quizzes), plus the Week -> Week unlock gate driven by
 * each week's knowledge-check interview.
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type {
  LearningRoadmapDoc,
  QuizDoc,
  QuizQuestion,
  RoadmapQuiz,
  RoadmapSubtopic,
  RoadmapTopic,
  RoadmapWeek,
  SubtopicNotesDoc,
} from '../interfaces/learning-roadmap.interface';
import { generateJson } from '../library/gemini-client';
import { AppError } from '../shared/utils';
import { ensureAdmin } from '../utils/callable-auth';
import {
  learningRoadmapQuizRef,
  learningRoadmapRef,
  learningRoadmapSubtopicNotesRef,
} from '../utils/firestore-refs';
import {
  quizQuestionsSchema,
  roadmapSkeletonSchema,
  subtopicNotesSchema,
} from './learning-roadmap.schema';

const PASS_THRESHOLD = 60;

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

/**
 * Generates (or returns the existing) 4-week roadmap for a technology.
 * Write-once — re-calling with a different technology after one exists returns the original
 * roadmap, mirroring the resume onboarding plan's write-once rule.
 */
export async function generateRoadmap(
  uid: string,
  technology: string,
): Promise<LearningRoadmapDoc> {
  const db = ensureAdmin();
  const ref = learningRoadmapRef(db, uid);
  const existing = await ref.get();
  if (existing.exists) {
    const doc = existing.data() as LearningRoadmapDoc;
    return { ...doc, weeks: computeWeekState(doc.weeks) };
  }

  const trimmedTechnology = technology.trim();
  if (!trimmedTechnology) {
    throw new AppError(400, 'technology is required.');
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
    maxOutputTokens: 24576,
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

  await ref.set({
    technology: trimmedTechnology,
    weeks,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  } as never);

  const saved = await ref.get();
  const doc = saved.data() as LearningRoadmapDoc;
  return { ...doc, weeks: computeWeekState(doc.weeks) };
}

export async function getActiveRoadmap(uid: string): Promise<LearningRoadmapDoc> {
  const db = ensureAdmin();
  const snap = await learningRoadmapRef(db, uid).get();
  if (!snap.exists) {
    throw new AppError(404, 'No learning roadmap found for this account.');
  }
  const doc = snap.data() as LearningRoadmapDoc;
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
  subtopicId: string,
): Promise<SubtopicNotesDoc> {
  const db = ensureAdmin();
  const roadmapSnap = await learningRoadmapRef(db, uid).get();
  if (!roadmapSnap.exists) {
    throw new AppError(404, 'No learning roadmap found for this account.');
  }
  const roadmap = roadmapSnap.data() as LearningRoadmapDoc;
  const found = findSubtopic(roadmap, subtopicId);
  if (!found) {
    throw new AppError(404, 'Subtopic not found in your learning roadmap.');
  }

  const notesRef = learningRoadmapSubtopicNotesRef(db, uid, subtopicId);
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
      'string[] (optional) } ], "keyTakeaways": string[] }. Keep the notes around 1500-2200 words ' +
      'across 5-9 sections, covering the subtopic in full detail rather than a short summary.',
    userPrompt: JSON.stringify({ subtopic: subtopic.name, topic: topic.name, technology }),
    maxOutputTokens: 8192,
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
  subtopicId: string,
): Promise<LearningRoadmapDoc> {
  const db = ensureAdmin();
  const ref = learningRoadmapRef(db, uid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new AppError(404, 'No learning roadmap found for this account.');
  }
  const doc = snap.data() as LearningRoadmapDoc;
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
  quizId: string,
): Promise<QuizDoc> {
  const db = ensureAdmin();
  const roadmapSnap = await learningRoadmapRef(db, uid).get();
  if (!roadmapSnap.exists) {
    throw new AppError(404, 'No learning roadmap found for this account.');
  }
  const roadmap = roadmapSnap.data() as LearningRoadmapDoc;
  const found = findQuiz(roadmap, quizId);
  if (!found) {
    throw new AppError(404, 'Quiz not found in your learning roadmap.');
  }

  const quizRef = learningRoadmapQuizRef(db, uid, quizId);
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
 * into the owning topic's completion state.
 */
export async function submitQuiz(
  uid: string,
  quizId: string,
  answers: Record<string, string>,
): Promise<{ score: number; roadmap: LearningRoadmapDoc }> {
  const db = ensureAdmin();
  const quizSnap = await learningRoadmapQuizRef(db, uid, quizId).get();
  if (!quizSnap.exists) {
    throw new AppError(404, 'Quiz not found. Open the quiz before submitting.');
  }
  const quizDoc = quizSnap.data() as QuizDoc;
  const total = quizDoc.questions.length;
  const correct = quizDoc.questions.filter(
    (q) => answers[q.id] === q.correctAnswer,
  ).length;
  const score = total > 0 ? Math.round((correct / total) * 100) : 0;

  const ref = learningRoadmapRef(db, uid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new AppError(404, 'No learning roadmap found for this account.');
  }
  const doc = snap.data() as LearningRoadmapDoc;
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
  return { score, roadmap: { ...doc, weeks: computeWeekState(weeks) } };
}

/** Parses `learning-roadmap:week{W}` — the tag interviews use to link back here. */
export function parseLearningRoadmapActivityId(
  sourceRoadmapActivityId: string | undefined,
): { week: number } | null {
  if (!sourceRoadmapActivityId) return null;
  const match = /^learning-roadmap:week(\d+)$/.exec(sourceRoadmapActivityId);
  if (!match) return null;
  return { week: Number(match[1]) };
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
  week: number,
  overallScore: number,
  interviewId: string,
): Promise<void> {
  const db = ensureAdmin();
  const ref = learningRoadmapRef(db, uid);
  const snap = await ref.get();
  if (!snap.exists) return;

  const doc = snap.data() as LearningRoadmapDoc;
  const weekIndex = doc.weeks.findIndex((w) => w.weekNumber === week);
  if (weekIndex === -1) return;

  const passed = overallScore >= PASS_THRESHOLD;
  const weeks = doc.weeks.map((w, index) => {
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
}
