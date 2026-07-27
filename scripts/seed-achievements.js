/**
 * Seed master achievements into Firestore.
 *
 * Collection: achievements/{achievementId}
 * Project:    interview-89e09
 *
 * Upserts all catalog docs (merge). Safe to re-run — updates existing docs
 * with new fields (iconKey, metric, track) without deleting progress data.
 *
 * Prerequisites:
 *   1. firebase-service-account.json at repo root
 *   2. npm install inside functions/ (for firebase-admin)
 *
 * Usage:
 *   npm run seed:achievements
 */

const path = require('path');
const admin = require(path.join(__dirname, '../functions/node_modules/firebase-admin'));
const { ACHIEVEMENT_CATALOG } = require('./data/achievement-catalog');

const COLLECTION = 'achievements';
const BATCH_LIMIT = 400;

const serviceAccountPath = path.resolve(__dirname, '../firebase-service-account.json');
const serviceAccount = require(serviceAccountPath);

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

async function seedAchievements() {
  console.log(`Seeding ${COLLECTION} (${ACHIEVEMENT_CATALOG.length} docs)...`);

  const collectionRef = db.collection(COLLECTION);
  let batch = db.batch();
  let writesInBatch = 0;
  let upserted = 0;

  for (const achievement of ACHIEVEMENT_CATALOG) {
    const docRef = collectionRef.doc(achievement.id);
    const payload = {
      id: achievement.id,
      name: achievement.name,
      description: achievement.description,
      category: achievement.category,
      rarity: achievement.rarity,
      points: achievement.points,
      iconUrl: achievement.iconUrl || '',
      iconKey: achievement.iconKey,
      criteria: achievement.criteria,
      targetValue: achievement.targetValue,
      order: achievement.order,
      isActive: achievement.isActive !== false,
      metric: achievement.metric,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (achievement.track) {
      payload.track = achievement.track;
    }

    batch.set(docRef, payload, { merge: true });
    writesInBatch += 1;
    upserted += 1;

    if (writesInBatch === BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      writesInBatch = 0;
    }
  }

  if (writesInBatch > 0) {
    await batch.commit();
  }

  console.log(`Upserted ${upserted} achievements into ${COLLECTION}.`);
}

seedAchievements().catch((error) => {
  console.error('Failed to seed achievements:', error);
  process.exit(1);
});
