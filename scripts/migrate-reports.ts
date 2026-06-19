/**
 * Migrates legacy report documents (random Firestore IDs) to canonical IDs: report__{interviewId}
 *
 * Usage:
 *   npm run migrate:reports          # dry-run (default)
 *   npm run migrate:reports -- --apply
 */
import "dotenv/config";
import { appConfig } from "../src/config/app.config";
import { secretService, SecretValidationError } from "../src/config/secrets";
import { initializeFirebase } from "../src/config/firebase";
import { db } from "../src/config/firebase";
import { COLLECTIONS, LEGACY_COLLECTIONS } from "../src/shared/constants";
import { isCanonicalReportId, toReportDocId } from "../src/shared/firestore-ids";

interface LegacyReport {
  id?: string;
  interviewId: string;
  userId: string;
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  pending?: boolean;
  createdAt?: { toMillis?: () => number };
}

const apply = process.argv.includes("--apply");

try {
  secretService.initialize();
  initializeFirebase();
} catch (error) {
  if (error instanceof SecretValidationError) {
    console.error(error.message);
  } else if (error instanceof Error) {
    console.error("Startup failed:", error.message);
  }
  process.exit(1);
}

const migrateReports = async (): Promise<void> => {
  const snap = await db.collection(LEGACY_COLLECTIONS.REPORTS).get();
  let migrated = 0;
  let skipped = 0;
  let deleted = 0;

  console.log(`Found ${snap.size} report document(s). Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Environment: ${appConfig.nodeEnv}`);

  for (const doc of snap.docs) {
    if (isCanonicalReportId(doc.id)) {
      skipped++;
      continue;
    }

    const data = doc.data() as LegacyReport;

    if (!data.interviewId) {
      console.warn(`  SKIP ${doc.id}: missing interviewId`);
      skipped++;
      continue;
    }

    if (data.pending) {
      console.warn(`  SKIP ${doc.id}: pending placeholder (interviewId=${data.interviewId})`);
      skipped++;
      continue;
    }

    const targetId = toReportDocId(data.interviewId);
    const targetRef = db.collection(LEGACY_COLLECTIONS.REPORTS).doc(targetId);
    const targetSnap = await targetRef.get();

    if (targetSnap.exists && !targetSnap.data()?.pending) {
      console.log(`  DELETE legacy ${doc.id} → canonical ${targetId} already exists`);
      if (apply) {
        await doc.ref.delete();
        deleted++;
      }
      continue;
    }

    const payload = {
      id: targetId,
      interviewId: data.interviewId,
      userId: data.userId,
      overallScore: data.overallScore,
      strengths: data.strengths ?? [],
      weaknesses: data.weaknesses ?? [],
      recommendations: data.recommendations ?? [],
      ...(data.createdAt && { createdAt: data.createdAt }),
    };

    console.log(`  MIGRATE ${doc.id} → ${targetId} (interviewId=${data.interviewId})`);

    if (apply) {
      await targetRef.set(payload, { merge: false });
      await doc.ref.delete();
      migrated++;
    }
  }

  console.log("");
  console.log(`Done. migrated=${migrated} deleted_duplicates=${deleted} skipped=${skipped}`);

  if (!apply) {
    console.log("No changes written. Re-run with --apply to execute.");
  }
};

migrateReports().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
