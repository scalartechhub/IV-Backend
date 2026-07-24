/**
 * Report generation after interview completion.
 */

import { FieldValue } from 'firebase-admin/firestore';
import type { InterviewResults } from '../interfaces/interview.interface';
import { ensureAdmin } from '../utils/callable-auth';
import { interviewRef, reportsCol } from '../utils/firestore-refs';

/**
 * Generate a per-interview report doc under users/{uid}/reports.
 */
export async function generateReport(
  uid: string,
  interviewId: string,
  results: InterviewResults,
): Promise<string> {
  const db = ensureAdmin();
  const reportRef = reportsCol(db, uid).doc();
  await reportRef.set({
    interviewId,
    generatedAt: FieldValue.serverTimestamp() as never,
    summary: `Overall score ${results.overallScore}. Strengths: ${results.strengths.slice(0, 2).join('; ') || 'n/a'}.`,
    charts: {
      skillBreakdown: {
        technical: results.technicalScore,
        communication: results.communicationScore,
        confidence: results.confidenceScore,
        problemSolving: results.problemSolvingScore,
        ...(results.codingScore !== undefined
          ? { coding: results.codingScore }
          : {}),
        ...(results.behaviorScore !== undefined
          ? { behavior: results.behaviorScore }
          : {}),
      },
      timeline: [{ label: 'Overall', score: results.overallScore }],
    },
    strengths: results.strengths,
    weaknesses: results.weaknesses,
    recommendations: results.recommendations,
  });

  await interviewRef(db, interviewId).update({ reportId: reportRef.id });

  await db
    .collection('users')
    .doc(uid)
    .collection('notifications')
    .add({
      type: 'report_ready',
      title: 'Interview report ready',
      body: 'Your detailed interview report is available.',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
      actionUrl: `/reports/${reportRef.id}`,
      relatedId: reportRef.id,
    });

  return reportRef.id;
}
