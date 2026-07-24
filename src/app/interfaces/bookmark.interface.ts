import type { Timestamp } from 'firebase/firestore';

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
