/**
 * Normalize AI / free-text experience into onboarding year buckets.
 * Buckets match the frontend catalog: Student | 0-1 | 1-3 | 3-5 | 5-10 | 10+.
 */

export const EXPERIENCE_YEAR_LABELS = [
  'Student',
  '0-1 years',
  '1-3 years',
  '3-5 years',
  '5-10 years',
  '10+ years',
] as const;

export type ExperienceYearLabel = (typeof EXPERIENCE_YEAR_LABELS)[number];

function normalizeText(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9.+]+/g, ' ').trim();
}

function yearsToLabel(years: number): ExperienceYearLabel {
  if (years >= 10) return '10+ years';
  if (years >= 5) return '5-10 years';
  if (years >= 3) return '3-5 years';
  if (years >= 1) return '1-3 years';
  return '0-1 years';
}

/**
 * Map free-text experience (from ATS / onboarding AI) to a standard year-bucket label.
 * Prefer explicit year ranges or counts over vague seniority words.
 */
export function normalizeExperienceYearsLabel(
  raw: string | undefined | null,
  fallback: ExperienceYearLabel = '1-3 years',
): ExperienceYearLabel {
  const text = normalizeText(String(raw ?? ''));
  if (!text) return fallback;

  if (/\bstudent\b|\bintern(ship)?\b|\bundergraduate\b/.test(text)) {
    return 'Student';
  }

  // Explicit catalog-style ranges first.
  if (/\b0\s*[-–.]?\s*1\s*(years?|yrs?)?\b|\bless than (a |1 |one )?year\b|\bunder 1\b/.test(text)) {
    return '0-1 years';
  }
  if (/\b1\s*[-–.]?\s*3\s*(years?|yrs?)?\b/.test(text)) return '1-3 years';
  if (/\b3\s*[-–.]?\s*5\s*(years?|yrs?)?\b/.test(text)) return '3-5 years';
  if (/\b5\s*[-–.]?\s*10\s*(years?|yrs?)?\b/.test(text)) return '5-10 years';
  if (/\b10\s*\+|\b10\s*plus\b|\b10\s*\+?\s*(years?|yrs?)\b/.test(text)) return '10+ years';

  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:to|-|–|\.)\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)?/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return yearsToLabel((a + b) / 2);
    }
  }

  const yearsMatch = text.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/);
  if (yearsMatch) {
    const n = Number(yearsMatch[1]);
    if (Number.isFinite(n)) return yearsToLabel(n);
  }

  // Bare number only when clearly experience context (avoid matching scores).
  const bare = text.match(/\b(\d+(?:\.\d+)?)\s*\+?\b/);
  if (bare && /(year|yr|exp|experience)/.test(text)) {
    const n = Number(bare[1]);
    if (Number.isFinite(n)) return yearsToLabel(n);
  }

  if (/\bfresher\b|\bentry[- ]?level\b|\bjunior\b|\bgraduate\b|\bnew grad\b/.test(text)) {
    return '0-1 years';
  }
  if (/\bprincipal\b|\bstaff\b|\bdirector\b|\bvp\b|\bhead of\b|\blead\b/.test(text)) {
    return '10+ years';
  }
  if (/\bsenior\b|\bsr\b/.test(text)) return '5-10 years';
  if (/\bmid[- ]?senior\b|\bmid[- ]?level\b|\bmidlevel\b|\bintermediate\b/.test(text)) {
    return '3-5 years';
  }

  return fallback;
}

/** Best-effort numeric years for profile.yearsExperience. */
export function parseYearsExperience(raw: string | undefined | null): number | undefined {
  if (!raw?.trim()) return undefined;

  const normalized = normalizeExperienceYearsLabel(raw, '1-3 years');
  switch (normalized) {
    case 'Student':
    case '0-1 years':
      return 0;
    case '1-3 years':
      return 2;
    case '3-5 years':
      return 4;
    case '5-10 years':
      return 7;
    case '10+ years':
      return 10;
    default:
      return undefined;
  }
}
