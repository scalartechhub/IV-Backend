import { db, getStorageBucket } from '../../config/firebase';
import { AppError } from '../../shared/utils';
import { DocumentSnapshot, Query } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

export interface AdminUserListInput {
  actorUid: string;
  pageSize: number;
  cursor?: string | null;
  sort?: string;
  search?: string;
  plan?: string;
  onboarding?: string;
  interviewUse?: string;
  payment?: string;
}

export interface AdminUserListResult {
  users: Array<Record<string, unknown> & { uid: string }>;
  nextCursor: string | null;
  total: number | null;
}

type UserRow = Record<string, unknown> & { uid: string };
type LooseDoc = Record<string, unknown> & { id: string };

const BATCH = 30;
const MAX_BATCHES = 20;

export async function listAdminUsers(input: AdminUserListInput): Promise<AdminUserListResult> {
  await assertSuperAdmin(input.actorUid);

  const pageSize = clampPageSize(input.pageSize);
  const sort = input.sort || 'recent';
  const { field, direction } = sortSpec(sort);
  const narrowing = hasNarrowing(input);
  const total = !narrowing && (sort === 'recent' || sort === 'oldest')
    ? (await db.collection('users').count().get()).data().count
    : null;

  const matches: UserRow[] = [];
  let scanCursor = input.cursor?.trim() || null;
  let nextCursor: string | null = null;

  for (let batch = 0; batch < MAX_BATCHES && matches.length < pageSize; batch += 1) {
    let userQuery: Query = db.collection('users').orderBy(field, direction).limit(BATCH);
    if (scanCursor) {
      const cursorSnap = await db.collection('users').doc(scanCursor).get();
      if (!cursorSnap.exists) break;
      userQuery = userQuery.startAfter(cursorSnap);
    }

    const snap = await userQuery.get();
    if (snap.empty) break;

    const filtered = await applyFilters(snap.docs.map(toUser), input);
    for (const row of filtered) {
      if (matches.length >= pageSize) break;
      matches.push(row);
    }

    const lastIncluded = matches[matches.length - 1];
    const includedHere = Boolean(lastIncluded && snap.docs.some(doc => doc.id === lastIncluded.uid));
    if (matches.length >= pageSize && includedHere) {
      const index = snap.docs.findIndex(doc => doc.id === lastIncluded.uid);
      const hasMore = index < snap.docs.length - 1 || snap.size === BATCH;
      nextCursor = hasMore ? lastIncluded.uid : null;
      break;
    }

    if (snap.size < BATCH) {
      nextCursor = null;
      break;
    }
    scanCursor = snap.docs[snap.docs.length - 1].id;
  }

  const withResumes = await attachResumeSummaries(matches);
  return { users: withResumes.map(serializeUser), nextCursor, total };
}

/**
 * Light resume hints for the users table (no signed URLs — open uses /resume).
 * Analysis fileName comes from users/{uid}/onboarding/analysis.storagePath.
 * Invited comes from users/{uid}.jobApplication.
 */
async function attachResumeSummaries(users: UserRow[]): Promise<UserRow[]> {
  if (!users.length) return users;

  const analysisRefs = users.map(user =>
    db.collection('users').doc(user.uid).collection('onboarding').doc('analysis'),
  );
  const analysisSnaps = await db.getAll(...analysisRefs);

  return users.map((user, index) => {
    const snap = analysisSnaps[index];
    const data = snap?.exists ? (snap.data() || {}) : {};
    const analysisPath = normalizeStoragePath(String(data.storagePath || ''));
    const analysisFileName = analysisPath
      ? (String(data.fileName || '').trim() || fileNameFromPath(analysisPath))
      : null;

    const app = (user.jobApplication || {}) as Record<string, unknown>;
    const invitedUrl = String(app.resumeUrl || '').trim();
    const invitedPath = normalizeStoragePath(String(app.resumeStoragePath || ''));
    const hasInvited = Boolean(invitedUrl || invitedPath);
    const invitedFileName = hasInvited
      ? (String(app.resumeFileName || '').trim()
        || (invitedPath ? fileNameFromPath(invitedPath) : '')
        || 'Invited resume')
      : null;

    return {
      ...user,
      resumeSummary: {
        analysisFileName,
        invitedFileName,
        invitedUrl: invitedUrl.startsWith('http://') || invitedUrl.startsWith('https://')
          ? invitedUrl
          : null,
      },
    };
  });
}

async function assertSuperAdmin(uid: string): Promise<void> {
  const [primary, legacy] = await Promise.all([
    db.collection('superAdmins').doc(uid).get(),
    db.collection('superadmins').doc(uid).get(),
  ]);
  if (!primary.exists && !legacy.exists) {
    throw new AppError(403, 'Super admin access is required');
  }
}

export interface AdminUserResumeResult {
  kind: 'analysis' | 'invited';
  fileName: string;
  url: string;
  storagePath: string | null;
}

export interface AdminUserResumesResult {
  analysis: AdminUserResumeResult | null;
  invited: AdminUserResumeResult | null;
}

/**
 * Resolve analysis + invited resumes for super-admin preview/download.
 * Uses Admin Storage signed URLs so client Storage rules do not block the preview.
 * Always returns both slots (null when missing) — never 404 for "none found".
 */
export async function getAdminUserResume(
  actorUid: string,
  targetUid: string,
): Promise<AdminUserResumesResult> {
  await assertSuperAdmin(actorUid);
  const uid = (targetUid || '').trim();
  if (!uid) throw new AppError(400, 'User id is required');

  const bucketName = getStorageBucket();
  if (!bucketName) throw new AppError(500, 'Storage bucket is not configured');

  const [analysisPath, invitedPath] = await Promise.all([
    resolveAnalysisResumePath(uid, bucketName),
    resolveInvitedResumePath(uid, bucketName),
  ]);

  const [analysis, invited] = await Promise.all([
    analysisPath ? signResume(bucketName, analysisPath, 'analysis') : Promise.resolve(null),
    invitedPath ? signResume(bucketName, invitedPath, 'invited') : Promise.resolve(null),
  ]);

  return { analysis, invited };
}

async function signResume(
  bucketName: string,
  resolved: { fileName: string; storagePath: string | null; url?: string },
  kind: 'analysis' | 'invited',
): Promise<AdminUserResumeResult | null> {
  if (resolved.storagePath) {
    const file = getStorage().bucket(bucketName).file(resolved.storagePath);
    const [exists] = await file.exists();
    if (exists) {
      const safeName = resolved.fileName.replace(/"/g, '') || 'resume.pdf';
      const contentType = contentTypeForName(safeName);
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000,
        responseDisposition: `inline; filename="${safeName}"`,
        ...(contentType ? { responseType: contentType } : {}),
      });
      return {
        kind,
        fileName: resolved.fileName,
        url,
        storagePath: resolved.storagePath,
      };
    }
  }

  // Fall back to a stored download URL when the Storage object is missing.
  if (resolved.url && (resolved.url.startsWith('http://') || resolved.url.startsWith('https://'))) {
    return {
      kind,
      fileName: resolved.fileName,
      url: resolved.url,
      storagePath: resolved.storagePath,
    };
  }

  return null;
}

async function resolveAnalysisResumePath(
  uid: string,
  bucketName: string,
): Promise<{ fileName: string; storagePath: string | null; url?: string } | null> {
  const candidates: Array<{ fileName: string; storagePath: string | null; url?: string }> = [];

  const docPaths = [
    db.collection('users').doc(uid).collection('onboarding').doc('analysis'),
    db.collection('users').doc(uid).collection('resume').doc('analysis'),
  ];

  for (const ref of docPaths) {
    const snap = await ref.get();
    if (!snap.exists) continue;
    const data = snap.data() || {};
    const fromField = normalizeStoragePath(String(data.storagePath || ''));
    const fromUrl = storagePathFromUrl(String(data.resumeUrl || data.downloadUrl || ''));
    const storagePath = fromField || fromUrl;
    const fileName = String(data.fileName || '').trim()
      || (storagePath ? fileNameFromPath(storagePath) : 'analysis-resume.pdf');
    if (storagePath) candidates.push({ fileName, storagePath });
  }

  const fromFolder = await firstFileInPrefix(bucketName, `users/${uid}/resumes/`);
  if (fromFolder) candidates.push(fromFolder);

  const fallbackPath = `users/${uid}/resumes/resume.pdf`;
  candidates.push({ fileName: 'resume.pdf', storagePath: fallbackPath });

  for (const candidate of candidates) {
    if (!candidate.storagePath) continue;
    const [exists] = await getStorage().bucket(bucketName).file(candidate.storagePath).exists();
    if (exists) return candidate;
  }
  return null;
}

async function resolveInvitedResumePath(
  uid: string,
  bucketName: string,
): Promise<{ fileName: string; storagePath: string | null; url?: string } | null> {
  const userSnap = await db.collection('users').doc(uid).get();
  const app = ((userSnap.data() || {}).jobApplication || {}) as Record<string, unknown>;
  const resumeUrl = String(app.resumeUrl || '').trim();
  const fromField = normalizeStoragePath(String(app.resumeStoragePath || ''));
  const fromUrl = storagePathFromUrl(resumeUrl);
  const storagePath = fromField || fromUrl;
  const fileName = String(app.resumeFileName || '').trim()
    || (storagePath ? fileNameFromPath(storagePath) : 'invited-resume.pdf');

  if (storagePath) {
    const [exists] = await getStorage().bucket(bucketName).file(storagePath).exists();
    if (exists) return { fileName, storagePath, url: resumeUrl || undefined };
    if (resumeUrl.startsWith('http://') || resumeUrl.startsWith('https://')) {
      return { fileName, storagePath: null, url: resumeUrl };
    }
  }

  if (resumeUrl.startsWith('http://') || resumeUrl.startsWith('https://')) {
    return { fileName, storagePath: null, url: resumeUrl };
  }

  if (resumeUrl) {
    const asPath = normalizeStoragePath(resumeUrl);
    if (asPath) {
      const [exists] = await getStorage().bucket(bucketName).file(asPath).exists();
      if (exists) return { fileName, storagePath: asPath };
    }
  }

  return firstFileInPrefix(bucketName, `users/${uid}/job-resumes/`);
}

async function firstFileInPrefix(
  bucketName: string,
  prefix: string,
): Promise<{ fileName: string; storagePath: string } | null> {
  try {
    const [files] = await getStorage().bucket(bucketName).getFiles({
      prefix,
      autoPaginate: false,
      maxResults: 40,
    });
    const preferred = files.find(file =>
      !file.name.endsWith('/') && file.name.toLowerCase().endsWith('.pdf'));
    const anyFile = preferred
      || files.find(file => !file.name.endsWith('/') && Boolean(fileNameFromPath(file.name)));
    if (!anyFile) return null;
    return { fileName: fileNameFromPath(anyFile.name), storagePath: anyFile.name };
  } catch {
    return null;
  }
}

function contentTypeForName(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return undefined;
}

/** Accept gs://, bare paths, and Firebase download URLs. */
function normalizeStoragePath(value: string): string {
  const trimmed = value.trim().replace(/^\/+/, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('gs://')) {
    const withoutScheme = trimmed.slice(5);
    const slash = withoutScheme.indexOf('/');
    return slash >= 0 ? withoutScheme.slice(slash + 1) : '';
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return storagePathFromUrl(trimmed);
  }
  return trimmed;
}

function storagePathFromUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    // https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encodedPath>?...
    const objectMatch = url.pathname.match(/\/o\/(.+)$/);
    if (objectMatch?.[1]) return decodeURIComponent(objectMatch[1]);
    // https://storage.googleapis.com/<bucket>/<path>
    if (url.hostname === 'storage.googleapis.com') {
      const parts = url.pathname.replace(/^\/+/, '').split('/');
      if (parts.length >= 2) return parts.slice(1).join('/');
    }
  } catch {
    return '';
  }
  return '';
}

function fileNameFromPath(storagePath: string): string {
  const parts = storagePath.split('/');
  return parts[parts.length - 1] || 'resume.pdf';
}

function clampPageSize(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(50, Math.max(1, Math.floor(value)));
}

function sortSpec(sort: string): { field: string; direction: 'asc' | 'desc' } {
  if (sort === 'oldest') return { field: 'createdAt', direction: 'asc' };
  if (sort === 'name') return { field: 'displayName', direction: 'asc' };
  if (sort === 'readiness') return { field: 'readinessScore', direction: 'desc' };
  return { field: 'createdAt', direction: 'desc' };
}

function hasNarrowing(input: AdminUserListInput): boolean {
  return Boolean(input.search?.trim())
    || Boolean(input.plan && input.plan !== 'ALL')
    || Boolean(input.onboarding && input.onboarding !== 'ALL')
    || Boolean(input.interviewUse && input.interviewUse !== 'ALL')
    || Boolean(input.payment && input.payment !== 'ALL');
}

function toUser(doc: DocumentSnapshot): UserRow {
  return { uid: doc.id, ...(doc.data() || {}) };
}

async function applyFilters(rows: UserRow[], input: AdminUserListInput): Promise<UserRow[]> {
  if (!rows.length) return [];
  const search = (input.search || '').trim().toLowerCase();
  const plan = input.plan || 'ALL';
  const onboarding = input.onboarding || 'ALL';
  const interviewUse = input.interviewUse || 'ALL';
  const payment = input.payment || 'ALL';
  const uids = rows.map(row => row.uid);

  const interviews = interviewUse !== 'ALL' ? await interviewsByUser(uids) : new Map<string, LooseDoc[]>();
  const billing = payment !== 'ALL' ? await billingByUser(uids) : { subscriptions: new Map<string, LooseDoc[]>(), payments: new Map<string, LooseDoc[]>() };

  return rows.filter(user => {
    if (search && !matchesSearch(user, search)) return false;
    if (plan !== 'ALL' && planKey(user) !== plan) return false;
    if (onboarding !== 'ALL' && onboardingStage(user) !== onboarding) return false;
    if (!matchesInterviewUse(interviews.get(user.uid) || [], interviewUse)) return false;
    if (payment === 'failed' && !hasPaymentFailure(user, billing)) return false;
    if (payment !== 'ALL' && payment !== 'failed' && paymentClass(user, billing) !== payment) return false;
    return true;
  });
}

function matchesSearch(user: UserRow, search: string): boolean {
  const app = (user.jobApplication || {}) as Record<string, unknown>;
  const haystack = [
    user.displayName,
    user.name,
    user.email,
    user.phone,
    user.uid,
    user.targetRole,
    user.currentRole,
    user.signupCountry,
    user.lastLoginCountry,
    app.linkedin,
    app.location,
    app.resumeFileName,
  ].map(value => String(value || '').toLowerCase());
  return haystack.some(value => value.includes(search));
}

function planKey(user: UserRow): string {
  const summary = (user.subscriptionSummary || {}) as Record<string, unknown>;
  const subscription = (user.subscription || {}) as Record<string, unknown>;
  const raw = String(summary.planId || subscription.plan || user.planTier || 'free').toLowerCase();
  if (raw.includes('elite') || raw === 'enterprise') return 'elite';
  if (raw.includes('pro')) return 'pro';
  return 'free';
}

function onboardingStage(user: UserRow): string {
  if (user.onboardingCompleted) return 'completed';
  const draft = user.onboardingDraft;
  if (draft && typeof draft === 'object' && Object.keys(draft as object).length > 0) return 'in_progress';
  if (draft && typeof draft !== 'object') return 'in_progress';
  return 'not_started';
}

function matchesInterviewUse(sessions: LooseDoc[], interviewUse: string): boolean {
  const live = sessions.filter(session => session.isDeleted !== true);
  if (interviewUse === 'used') return live.length > 0;
  if (interviewUse === 'never') return live.length === 0;
  if (interviewUse === 'live') return live.some(session => session.status === 'in_progress');
  if (interviewUse === 'completed') return live.some(session => session.status === 'completed');
  if (interviewUse === 'dropped') return live.some(session => session.status === 'abandoned' || session.status === 'expired');
  return true;
}

function paymentClass(user: UserRow, billing: BillingMaps): 'paid' | 'tried' | 'never' {
  const subs = billing.subscriptions.get(user.uid) || [];
  const payments = billing.payments.get(user.uid) || [];
  const summary = (user.subscriptionSummary || {}) as Record<string, unknown>;
  const subscription = (user.subscription || {}) as Record<string, unknown>;
  const summaryPlan = String(summary.planId || summary.planName || '');
  const summaryPaid = String(summary.status || '').toLowerCase() === 'active' && !isFreePlan(summaryPlan);
  const legacyPaid = String(subscription.status || '').toLowerCase() === 'active' && !isFreePlan(String(subscription.plan || ''));
  const captured = payments.some(payment => String(payment.status || '').toLowerCase() === 'captured');
  const activeSub = subs.some(sub => String(sub.status || '').toLowerCase() === 'active' && !isFreePlan(planIdOf(sub)));
  if (summaryPaid || legacyPaid || captured || activeSub) return 'paid';
  const linkedCheckout = subs.some(sub => !isFreePlan(planIdOf(sub)));
  const payTried = payments.some(payment => String(payment.status || '').toLowerCase() !== 'captured');
  if (linkedCheckout || payTried) return 'tried';
  return 'never';
}

function hasPaymentFailure(user: UserRow, billing: BillingMaps): boolean {
  if (paymentClass(user, billing) === 'paid') return false;
  const payments = billing.payments.get(user.uid) || [];
  const subs = billing.subscriptions.get(user.uid) || [];
  const failedPayment = payments.some(payment => String(payment.status || '').toLowerCase() === 'failed');
  const failedSub = subs.some(sub => {
    const status = String(sub.status || '').toLowerCase();
    return Boolean(sub.lastFailureReason) || status === 'failed' || status === 'halted';
  });
  return failedPayment || failedSub;
}

function isFreePlan(planId?: string): boolean {
  const plan = String(planId || '').toLowerCase();
  return !plan || plan === 'free' || plan === 'none';
}

function planIdOf(sub: LooseDoc): string {
  return String(sub.planId || sub.planTier || '').toLowerCase();
}

type BillingMaps = {
  subscriptions: Map<string, LooseDoc[]>;
  payments: Map<string, LooseDoc[]>;
};

async function interviewsByUser(uids: string[]): Promise<Map<string, LooseDoc[]>> {
  const map = new Map<string, LooseDoc[]>();
  for (const chunk of chunks(uids, 10)) {
    const snap = await db.collection('interviews').where('userId', 'in', chunk).select('userId', 'status', 'isDeleted').get();
    for (const doc of snap.docs) {
      const data = doc.data() as LooseDoc;
      const uid = String(data.userId || '');
      if (!uid) continue;
      const list = map.get(uid) || [];
      list.push({ ...data, id: doc.id });
      map.set(uid, list);
    }
  }
  return map;
}

async function billingByUser(uids: string[]): Promise<BillingMaps> {
  const subscriptions = new Map<string, LooseDoc[]>();
  const payments = new Map<string, LooseDoc[]>();
  const push = (map: Map<string, LooseDoc[]>, uid: string, doc: LooseDoc) => {
    const list = map.get(uid) || [];
    if (!list.some(item => item.id === doc.id)) list.push(doc);
    map.set(uid, list);
  };

  for (const chunk of chunks(uids, 10)) {
    const [byField, paymentSnap, legacy] = await Promise.all([
      db.collection('subscriptions').where('userId', 'in', chunk).get(),
      db.collection('payments').where('userId', 'in', chunk).get(),
      db.getAll(...chunk.map(uid => db.collection('subscriptions').doc(uid))),
    ]);
    for (const doc of byField.docs) {
      const data = doc.data() as LooseDoc;
      push(subscriptions, String(data.userId || ''), { ...data, id: doc.id });
    }
    for (const doc of legacy) {
      if (!doc.exists) continue;
      const data = doc.data() as LooseDoc;
      const owner = String(data.userId || data.uid || doc.id);
      push(subscriptions, owner, { ...data, id: doc.id });
    }
    for (const doc of paymentSnap.docs) {
      const data = doc.data() as LooseDoc;
      const uid = String(data.userId || '');
      if (uid) push(payments, uid, { ...data, id: doc.id });
    }
  }
  return { subscriptions, payments };
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function serializeUser(user: UserRow): UserRow {
  return serializeValue(user) as UserRow;
}

function serializeValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = serializeValue(entry);
    }
    return out;
  }
  return value;
}
