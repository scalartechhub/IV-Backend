import { db } from '../../config/firebase';
import { AppError } from '../../shared/utils';
import { DocumentSnapshot, Query } from 'firebase-admin/firestore';

export type InterviewOriginFilter = 'ALL' | 'invited' | 'interview_link' | 'onboarded';

export interface AdminInterviewListInput {
  actorUid: string;
  pageSize: number;
  cursor?: string | null;
  sort?: string;
  search?: string;
  status?: string;
  origin?: string;
  userId?: string;
}

export interface AdminInterviewListResult {
  interviews: Array<Record<string, unknown> & { id: string; origin: InterviewOrigin }>;
  nextCursor: string | null;
  total: number | null;
}

type InterviewOrigin = 'invited' | 'interview_link' | 'onboarded';
type InterviewRow = Record<string, unknown> & { id: string };

/** Only fields the admin list UI needs — never pull conversation / system prompt. */
const LIST_SELECT = [
  'userId',
  'mode',
  'status',
  'candidateName',
  'candidateEmail',
  'createdAt',
  'startedAt',
  'completedAt',
  'durationSec',
  'liveElapsedSec',
  'endReason',
  'inviteId',
  'interviewLinkId',
  'interviewOrigin',
  'isInterviewInvite',
  'isDeleted',
  'config',
  'results',
] as const;

const SCAN_BATCH = 60;
const SCAN_MAX_BATCHES = 8;

export async function listAdminInterviews(
  input: AdminInterviewListInput,
): Promise<AdminInterviewListResult> {
  await assertSuperAdmin(input.actorUid);

  const pageSize = clampPageSize(input.pageSize);
  const direction = (input.sort || 'recent') === 'oldest' ? 'asc' : 'desc';
  const search = (input.search || '').trim().toLowerCase();
  const statusFilter = normalizeStatus(input.status);
  const originFilter = normalizeOrigin(input.origin);
  const userId = input.userId?.trim() || '';

  const cursor = input.cursor?.trim() || null;

  // Search cannot be pushed to Firestore indexes — short scan with projected fields.
  if (search) {
    return scanForSearch({
      pageSize,
      direction,
      search,
      statusFilter,
      originFilter,
      userId,
      cursor,
      pushOriginToQuery: true,
    });
  }

  try {
    // Fast path: one indexed page query (pageSize + 1 to detect next page).
    return await queryPage({
      pageSize,
      direction,
      statusFilter,
      originFilter,
      userId,
      cursor,
    });
  } catch (err) {
    // Indexes for status/origin may still be building — fall back to projected scan.
    if (!isRetryableQueryError(err)) throw err;
    return scanForSearch({
      pageSize,
      direction,
      search: '',
      statusFilter,
      originFilter,
      userId,
      cursor,
      pushOriginToQuery: false,
    });
  }
}

async function queryPage(args: {
  pageSize: number;
  direction: 'asc' | 'desc';
  statusFilter: string;
  originFilter: InterviewOriginFilter;
  userId: string;
  cursor: string | null;
}): Promise<AdminInterviewListResult> {
  const { pageSize, direction, statusFilter, originFilter, userId, cursor } = args;

  let q: Query = db.collection('interviews');

  if (userId) {
    q = q.where('userId', '==', userId);
  }
  if (statusFilter !== 'ALL') {
    q = q.where('status', '==', statusFilter);
  }
  // Prefer durable interviewOrigin for source filters (new sessions). Legacy docs without
  // the field are still classified in-memory when this equality is not applied.
  if (originFilter !== 'ALL') {
    q = q.where('interviewOrigin', '==', originFilter);
  }

  q = q.orderBy('createdAt', direction).select(...LIST_SELECT).limit(pageSize + 1);

  if (cursor) {
    const cursorSnap = await db.collection('interviews').doc(cursor).get();
    if (!cursorSnap.exists) {
      return { interviews: [], nextCursor: null, total: null };
    }
    q = q.startAfter(cursorSnap);
  }

  const snap = await q.get();
  const rows = snap.docs
    .map(toInterview)
    .filter(row => row.isDeleted !== true)
    // Defensive in-memory origin check if index returned unexpected rows
    .filter(row => originFilter === 'ALL' || resolveOrigin(row) === originFilter);

  const page = rows.slice(0, pageSize);
  const hasMore = rows.length > pageSize;
  const nextCursor = hasMore && page.length ? page[page.length - 1].id : null;

  return {
    interviews: page.map(serializeInterview),
    nextCursor,
    total: null,
  };
}

function isRetryableQueryError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code || '');
  const message = String((err as { message?: unknown })?.message || '').toLowerCase();
  return code === '9'
    || code === 'failed-precondition'
    || message.includes('requires an index')
    || message.includes('failed_precondition');
}

async function scanForSearch(args: {
  pageSize: number;
  direction: 'asc' | 'desc';
  search: string;
  statusFilter: string;
  originFilter: InterviewOriginFilter;
  userId: string;
  cursor: string | null;
  pushOriginToQuery: boolean;
}): Promise<AdminInterviewListResult> {
  const { pageSize, direction, search, statusFilter, originFilter, userId, pushOriginToQuery } = args;
  const matches: InterviewRow[] = [];
  let scanCursor = args.cursor;
  let nextCursor: string | null = null;

  for (let batch = 0; batch < SCAN_MAX_BATCHES && matches.length < pageSize; batch += 1) {
    let q: Query = db.collection('interviews');
    if (userId) q = q.where('userId', '==', userId);
    if (statusFilter !== 'ALL') q = q.where('status', '==', statusFilter);
    if (pushOriginToQuery && originFilter !== 'ALL') {
      q = q.where('interviewOrigin', '==', originFilter);
    }

    q = q.orderBy('createdAt', direction).select(...LIST_SELECT).limit(SCAN_BATCH);

    if (scanCursor) {
      const cursorSnap = await db.collection('interviews').doc(scanCursor).get();
      if (!cursorSnap.exists) break;
      q = q.startAfter(cursorSnap);
    }

    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const row = toInterview(doc);
      if (!matchesFilters(row, { search, statusFilter, originFilter })) continue;
      matches.push(row);
      if (matches.length >= pageSize) {
        const index = snap.docs.findIndex(d => d.id === row.id);
        const hasMoreInBatch = index < snap.docs.length - 1;
        nextCursor = hasMoreInBatch || snap.size === SCAN_BATCH ? row.id : null;
        break;
      }
    }

    if (matches.length >= pageSize) break;
    if (snap.size < SCAN_BATCH) {
      nextCursor = null;
      break;
    }
    scanCursor = snap.docs[snap.docs.length - 1].id;
  }

  return {
    interviews: matches.slice(0, pageSize).map(serializeInterview),
    nextCursor,
    total: null,
  };
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

function clampPageSize(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(50, Math.max(1, Math.floor(value)));
}

function normalizeStatus(status?: string): string {
  const value = (status || 'ALL').trim();
  if (!value || value.toUpperCase() === 'ALL') return 'ALL';
  return value.toLowerCase();
}

function normalizeOrigin(origin?: string): InterviewOriginFilter {
  const value = (origin || 'ALL').trim();
  if (value === 'invited' || value === 'interview_link' || value === 'onboarded') return value;
  return 'ALL';
}

function toInterview(doc: DocumentSnapshot): InterviewRow {
  return { id: doc.id, ...(doc.data() || {}) };
}

function matchesFilters(
  row: InterviewRow,
  filters: { search: string; statusFilter: string; originFilter: InterviewOriginFilter },
): boolean {
  if (row.isDeleted === true) return false;
  if (filters.statusFilter !== 'ALL' && String(row.status || '').toLowerCase() !== filters.statusFilter) {
    return false;
  }
  if (filters.originFilter !== 'ALL' && resolveOrigin(row) !== filters.originFilter) {
    return false;
  }
  if (filters.search && !matchesSearch(row, filters.search)) return false;
  return true;
}

export function resolveOrigin(row: InterviewRow): InterviewOrigin {
  const stored = String(row.interviewOrigin || '').trim();
  if (stored === 'invited' || stored === 'interview_link' || stored === 'onboarded') {
    return stored;
  }

  const config = (row.config || {}) as Record<string, unknown>;
  const inviteId = String(row.inviteId || config.inviteId || '').trim();
  const linkId = String(row.interviewLinkId || config.interviewLinkId || '').trim();
  if (inviteId) return 'invited';
  if (linkId) return 'interview_link';
  return 'onboarded';
}

function matchesSearch(row: InterviewRow, search: string): boolean {
  const config = (row.config || {}) as Record<string, unknown>;
  const haystack = [
    row.id,
    row.userId,
    row.candidateName,
    row.candidateEmail,
    row.mode,
    row.status,
    row.endReason,
    config.topic,
    config.targetRole,
    config.company,
    config.jdId,
    config.interviewLinkId,
    row.interviewLinkId,
    row.inviteId,
    config.inviteId,
  ].map(value => String(value || '').toLowerCase());
  return haystack.some(value => value.includes(search));
}

/** Slim payload for the table — omit transcripts, prompts, full results blobs. */
function serializeInterview(
  row: InterviewRow,
): Record<string, unknown> & { id: string; origin: InterviewOrigin } {
  const config = (row.config || {}) as Record<string, unknown>;
  const results = (row.results || {}) as Record<string, unknown>;

  return {
    id: row.id,
    userId: row.userId ?? null,
    mode: row.mode ?? null,
    status: row.status ?? null,
    candidateName: row.candidateName ?? null,
    candidateEmail: row.candidateEmail ?? null,
    createdAt: toIso(row.createdAt),
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
    durationSec: row.durationSec ?? null,
    liveElapsedSec: row.liveElapsedSec ?? null,
    endReason: row.endReason ?? null,
    inviteId: row.inviteId ?? null,
    interviewLinkId: row.interviewLinkId ?? null,
    interviewOrigin: resolveOrigin(row),
    origin: resolveOrigin(row),
    config: {
      topic: config.topic ?? null,
      targetRole: config.targetRole ?? null,
      company: config.company ?? null,
      jdId: config.jdId ?? null,
      interviewLinkId: config.interviewLinkId ?? null,
      inviteId: config.inviteId ?? null,
    },
    results: {
      overallScore: typeof results.overallScore === 'number' ? results.overallScore : null,
    },
  };
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === 'object' && value !== null && ('_seconds' in value || 'seconds' in value)) {
    const seconds = Number((value as { _seconds?: number; seconds?: number })._seconds
      ?? (value as { seconds?: number }).seconds
      ?? 0);
    return new Date(seconds * 1000).toISOString();
  }
  return null;
}
