// Mirrors src/app/interfaces/bookmark.interface.ts — keep in sync
import type { Timestamp } from 'firebase-admin/firestore';

export type BookmarkItemType =
  | 'question'
  | 'codingProblem'
  | 'roadmapActivity'
  | 'company';

/** Path: users/{uid}/bookmarks/{itemId} */
export interface BookmarkDoc {
  itemType: BookmarkItemType;
  itemId: string;
  title: string;
  bookmarkedAt: Timestamp;
}
