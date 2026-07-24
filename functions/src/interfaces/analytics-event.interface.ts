// Mirrors src/app/interfaces/analytics-event.interface.ts — keep in sync
import type { Timestamp } from 'firebase-admin/firestore';

/** Path: analyticsEvents/{eventId} */
export interface AnalyticsEventDoc {
  userId: string;
  eventType: string;
  /** Architecture uses Record<string, any>; unknown keeps callers type-safe */
  metadata: Record<string, unknown>;
  timestamp: Timestamp;
}
