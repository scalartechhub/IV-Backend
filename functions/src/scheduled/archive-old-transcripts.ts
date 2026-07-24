/**
 * Scheduled: daily 03:00 UTC — archive 90+ day conversation transcripts to Storage.
 */

import { gzipSync } from 'zlib';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { ensureAdmin, ensureStorage } from '../utils/callable-auth';
import { conversationCol, interviewRef } from '../utils/firestore-refs';
import { daysAgo } from '../utils/date-helpers';

const PAGE_SIZE = 50;

/**
 * Find completed interviews older than 90 days with conversation subcollections,
 * dump turns to archived-transcripts/{uid}/{interviewId}.json.gz, delete turns,
 * set transcriptArchived: true.
 */
export const archiveOldTranscripts = onSchedule(
  {
    schedule: 'every day 03:00',
    timeZone: 'UTC',
    region: 'us-central1',
    memory: '1GiB',
    timeoutSeconds: 540,
  },
  async () => {
    const db = ensureAdmin();
    const storage = ensureStorage();
    const cutoff = Timestamp.fromDate(daysAgo(90));

    const snap = await db
      .collection('interviews')
      .where('status', '==', 'completed')
      .where('completedAt', '<', cutoff)
      .where('transcriptArchived', '==', false)
      .limit(PAGE_SIZE)
      .get()
      .catch(async () => {
        // Fallback when transcriptArchived index/field missing
        const all = await db
          .collection('interviews')
          .where('status', '==', 'completed')
          .where('completedAt', '<', cutoff)
          .limit(PAGE_SIZE)
          .get();
        return {
          docs: all.docs.filter((d) => d.data().transcriptArchived !== true),
        };
      });

    const bucket = storage.bucket();

    for (const interviewDoc of snap.docs) {
      const data = interviewDoc.data();
      const uid = data.userId as string;
      const interviewId = interviewDoc.id;

      const turnsSnap = await conversationCol(db, interviewId).get();
      if (turnsSnap.empty) {
        await interviewRef(db, interviewId).update({
          transcriptArchived: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
        continue;
      }

      const turns = turnsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const json = JSON.stringify({ interviewId, userId: uid, turns });
      const compressed = gzipSync(Buffer.from(json, 'utf8'));
      const storagePath = `archived-transcripts/${uid}/${interviewId}.json.gz`;

      await bucket.file(storagePath).save(compressed, {
        contentType: 'application/gzip',
        metadata: { contentEncoding: 'gzip' },
      });

      // Delete conversation docs in batches of 500
      const docs = turnsSnap.docs;
      for (let i = 0; i < docs.length; i += 500) {
        const batch = db.batch();
        for (const d of docs.slice(i, i + 500)) {
          batch.delete(d.ref);
        }
        await batch.commit();
      }

      await interviewRef(db, interviewId).update({
        transcriptArchived: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  },
);
