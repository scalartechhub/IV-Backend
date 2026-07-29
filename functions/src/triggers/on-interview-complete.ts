/**
 * Trigger: when interview status flips to completed — safety-net achievement check.
 *
 * Primary evaluation runs inside interview.service.completeInterview (richer context).
 * Skip when that path already finished (xpEarned + results present) to avoid double-counting
 * incremental metrics like domain_sessions.
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import type { InterviewResults } from '../interfaces/interview.interface';
import { checkAchievements } from '../services/achievement.service';

export const onInterviewComplete = onDocumentUpdated(
  {
    document: 'interviews/{interviewId}',
    region: 'us-central1',
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (before.status === 'completed' || after.status !== 'completed') return;

    const userId = after.userId as string | undefined;
    if (!userId) return;

    // completeInterview writes xpEarned + results — skip duplicate evaluation.
    if (typeof after.xpEarned === 'number' && after.results) {
      return;
    }

    const results = after.results as InterviewResults | undefined;
    const config = after.config as
      | {
          technologies?: string[];
          skills?: string[];
          topic?: string;
          company?: string;
        }
      | undefined;
    const mode = after.mode as string | undefined;

    await checkAchievements(userId, {
      completed: true,
      overallScore: results?.overallScore,
      success: (results?.overallScore ?? 0) >= 70,
      deliveryScore: results?.communicationScore,
      contentScore: results?.technicalScore,
      skillScores: results
        ? {
            technical: results.technicalScore,
            communication: results.communicationScore,
            confidence: results.confidenceScore,
            problemSolving: results.problemSolvingScore,
            behavior: results.behaviorScore ?? 0,
          }
        : undefined,
      tracks: [
        mode,
        ...(config?.technologies ?? []),
        ...(config?.skills ?? []),
        config?.topic,
        config?.company,
      ].filter((value): value is string => Boolean(value?.trim())),
    });
  },
);
