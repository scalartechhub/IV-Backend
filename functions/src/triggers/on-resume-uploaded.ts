/**
 * Trigger: Storage finalize on resumes/{uid}/{resumeId}.pdf → enqueue analysis.
 * Prefer the uploadResume callable for full analysis; this covers direct Storage uploads.
 */

import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { FieldValue } from 'firebase-admin/firestore';
import { ensureAdmin } from '../utils/callable-auth';
import { resumesCol } from '../utils/firestore-refs';

/**
 * When a resume PDF lands in Storage, mark matching pending resume docs as processing.
 * Full ATS analysis is performed by uploadResume callable.
 */
export const onResumeUploaded = onObjectFinalized(
  {
    region: 'us-central1',
    memory: '512MiB',
  },
  async (event) => {
    const name = event.data.name;
    if (!name) return;

    // Expected path: resumes/{uid}/{resumeId}.pdf
    const match = /^resumes\/([^/]+)\/([^/]+)\.(pdf|docx)$/i.exec(name);
    if (!match) return;

    const [, uid, resumeId] = match;
    const db = ensureAdmin();
    const ref = resumesCol(db, uid).doc(resumeId);
    const snap = await ref.get();
    if (!snap.exists) {
      // Create a pending stub if client uploaded Storage first
      await ref.set(
        {
          fileName: name.split('/').pop() ?? resumeId,
          storagePath: name,
          version: 1,
          isActive: false,
          uploadedAt: FieldValue.serverTimestamp(),
          targetRole: '',
          analysis: {} as never,
          aiReviewedAt: FieldValue.serverTimestamp(),
          analysisStatus: 'pending',
        },
        { merge: true },
      );
      return;
    }

    if (snap.data()?.analysisStatus === 'pending') {
      await ref.update({ analysisStatus: 'processing' });
    }
  },
);
