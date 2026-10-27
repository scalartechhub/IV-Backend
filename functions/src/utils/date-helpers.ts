/**
 * Date helpers for weekly stats.
 * All calendar dates use UTC unless otherwise noted.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

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

/**
 * Paid-through date for a subscription.
 * A yearly plan stays active for a year from its start. A short gateway
 * cycle (about a month) must not be shown or enforced as the yearly expiry.
 */
export function resolveBillingPeriodEnd(
  billingCycle: string | undefined,
  periodStartIso: string | undefined,
  gatewayEndIso?: string,
): string | undefined {
  const startMs = periodStartIso ? new Date(periodStartIso).getTime() : NaN;
  const gatewayMs = gatewayEndIso ? new Date(gatewayEndIso).getTime() : NaN;

  if (billingCycle === "yearly" && !isNaN(startMs)) {
    const yearEndMs = startMs + YEAR_MS;
    if (isNaN(gatewayMs) || gatewayMs < yearEndMs - 15 * DAY_MS) {
      return new Date(yearEndMs).toISOString();
    }
    return new Date(gatewayMs).toISOString();
  }

  if (!isNaN(gatewayMs)) return new Date(gatewayMs).toISOString();
  if (!isNaN(startMs)) return new Date(startMs + MONTH_MS).toISOString();
  return gatewayEndIso;
}

export interface AnniversaryQuotaPeriod {
  key: string;
  start: Date;
  end: Date;
}

/**
 * Monthly quota window for a yearly subscription, anchored to the purchase instant.
 * Bought on 27 Oct → the allowance runs 27 Oct–27 Nov, then 27 Nov–27 Dec.
 * The yearly charge itself still happens once a year.
 */
export function resolveAnniversaryQuotaPeriod(
  anchorIso: string,
  now: Date = new Date(),
): AnniversaryQuotaPeriod {
  const anchor = new Date(anchorIso);
  if (isNaN(anchor.getTime())) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { key: `cycle_${formatDate(start)}`, start, end };
  }

  const anchorDay = anchor.getUTCDate();
  const clock = {
    h: anchor.getUTCHours(),
    min: anchor.getUTCMinutes(),
    s: anchor.getUTCSeconds(),
    ms: anchor.getUTCMilliseconds(),
  };

  const at = (year: number, monthIndex: number): Date => {
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const day = Math.min(anchorDay, lastDay);
    return new Date(Date.UTC(year, monthIndex, day, clock.h, clock.min, clock.s, clock.ms));
  };

  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let start = at(year, month);
  if (start.getTime() > now.getTime()) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
    start = at(year, month);
  }
  if (start.getTime() < anchor.getTime()) {
    start = new Date(anchor.getTime());
  }

  let endMonth = start.getUTCMonth() + 1;
  let endYear = start.getUTCFullYear();
  if (endMonth > 11) {
    endMonth = 0;
    endYear += 1;
  }
  let end = at(endYear, endMonth);
  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + MONTH_MS);
  }

  return {
    key: `cycle_${formatDate(start)}`,
    start,
    end,
  };
}
