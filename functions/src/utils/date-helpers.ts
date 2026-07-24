/**
 * Date helpers for streak / weekly stats.
 * All calendar dates use UTC unless otherwise noted.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Format a Date as YYYY-MM-DD in UTC.
 */
export function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Subtract whole days from a Date (returns a new Date).
 */
export function subDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * DAY_MS);
}

/**
 * Monday 00:00:00.000 UTC of the week containing `date`.
 * Returns YYYY-MM-DD string used as weeklyStats doc id.
 */
export function getWeekStart(date: Date = new Date()): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return formatDate(d);
}

/**
 * Lowercase weekday abbrev for practiceMinutesByDay keys: mon, tue, …
 */
export function dayAbbrev(date: Date): string {
  const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  return names[date.getUTCDay()];
}

/**
 * Instant N days ago.
 */
export function daysAgo(days: number, from: Date = new Date()): Date {
  return subDays(from, days);
}
