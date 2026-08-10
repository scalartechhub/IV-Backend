/**
 * Per-interview report reads under users/{uid}/reports.
 * Dashboard summary is built on the frontend from weeklyStats.
 */

import { AppError } from '../shared/utils';
import { ensureAdmin } from '../utils/callable-auth';
import { reportsCol } from '../utils/firestore-refs';

export async function listReports(uid: string, limit = 20) {
  const db = ensureAdmin();
  const snap = await reportsCol(db, uid)
    .orderBy('generatedAt', 'desc')
    .limit(Math.min(limit, 50))
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getReport(uid: string, reportId: string) {
  const db = ensureAdmin();
  const snap = await reportsCol(db, uid).doc(reportId).get();
  if (!snap.exists) throw new AppError(404, 'Report not found.');
  return { id: snap.id, ...snap.data() };
}
