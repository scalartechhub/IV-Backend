/**
 * Seeds career domain catalog + onboarding reference lists.
 *
 * interview_domain/{domainId}  — one doc per domain (label, icon, roles…)
 * appMetadata/{listId}         — journeyStages, experienceBuckets, etc.
 *
 * Usage: npm run seed:career-catalog
 */
const path = require('path');
const admin = require(path.join(__dirname, '../functions/node_modules/firebase-admin'));
const serviceAccount = require('../firebase-service-account.json');
const catalog = require('./data/career-catalog.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

const INTERVIEW_DOMAIN = 'interview_domain';
const APP_METADATA = 'appMetadata';

const METADATA_KEYS = [
  'welcomeDomainShortcuts',
  'journeyStages',
  'experienceBuckets',
  'suggestedCompanies',
  'educationLevels',
];

async function seedCareerCatalog() {
  const domains = catalog.careerDomains;
  if (!Array.isArray(domains) || domains.length === 0) {
    throw new Error('career-catalog.json has no careerDomains');
  }

  console.log(`Seeding ${domains.length} domains → ${INTERVIEW_DOMAIN}/{id}`);

  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();

  for (const domain of domains) {
    if (!domain?.id) {
      throw new Error('Domain missing id');
    }
    const ref = db.collection(INTERVIEW_DOMAIN).doc(domain.id);
    // Doc id = domain.id; body matches catalog object (id kept for client convenience).
    batch.set(ref, {
      id: domain.id,
      label: domain.label,
      icon: domain.icon,
      roles: domain.roles ?? [],
      updatedAt: now,
    });
  }

  for (const key of METADATA_KEYS) {
    if (catalog[key] === undefined) {
      throw new Error(`Missing metadata list: ${key}`);
    }
    const ref = db.collection(APP_METADATA).doc(key);
    batch.set(ref, {
      items: catalog[key],
      updatedAt: now,
    });
  }

  await batch.commit();

  console.log(`✅ Wrote ${domains.length} ${INTERVIEW_DOMAIN} docs`);
  console.log(`✅ Wrote ${METADATA_KEYS.length} ${APP_METADATA} docs: ${METADATA_KEYS.join(', ')}`);
  console.log('Done.');
}

seedCareerCatalog().catch((err) => {
  console.error(err);
  process.exit(1);
});
