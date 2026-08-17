/**
 * Compare the name on an uploaded resume with the signed-in user's registered name.
 * Fast local match first (initials, partial names, light typos), then Gemini.
 */

import { generateJson, RESUME_GEMINI_MODEL } from '../library/gemini-client';
import { logger } from '../shared/logger';

/** Lowercase, strip diacritics/punctuation, collapse whitespace. */
export function normalizePersonName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(0),
  );
  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

/** Exact, initial ("s" vs "sam"), prefix ("sam" vs "samuel"), or small typo. */
function tokensLikelySame(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length === 1 && b.startsWith(a)) return true;
  if (b.length === 1 && a.startsWith(b)) return true;
  if (a.length >= 3 && b.length >= a.length && b.startsWith(a)) return true;
  if (b.length >= 3 && a.length >= b.length && a.startsWith(b)) return true;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen <= 2) return dist === 0;
  if (maxLen <= 5) return dist <= 1;
  return dist <= 2;
}

/**
 * Every token in `shorter` maps, in order, to a token in `longer`
 * (initials, prefixes, or typos). Extra middle names on the longer side are ok.
 */
function orderedTokensCover(shorter: string[], longer: string[]): boolean {
  if (!shorter.length || !longer.length || shorter.length > longer.length) {
    return false;
  }
  let longerIndex = 0;
  for (const token of shorter) {
    let found = false;
    while (longerIndex < longer.length) {
      if (tokensLikelySame(token, longer[longerIndex])) {
        found = true;
        longerIndex += 1;
        break;
      }
      longerIndex += 1;
    }
    if (!found) return false;
  }
  return true;
}

/**
 * Heuristic: pick the candidate name from the top of resume plain text.
 * Skips emails, phones, URLs, and common section headers.
 */
export function extractCandidateNameFromResumeText(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);

  for (const line of lines) {
    if (/@|https?:\/\/|www\.|\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/i.test(line)) {
      continue;
    }
    if (
      /^(resume|curriculum|vitae|cv|objective|summary|profile|experience|education|skills|projects|contact)\b/i.test(
        line,
      )
    ) {
      continue;
    }
    if (line.length < 3 || line.length > 70) {
      continue;
    }

    const words = line.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 5) {
      continue;
    }
    if (!words.every((word) => /^[A-Za-z][A-Za-z.'’-]*$/.test(word))) {
      continue;
    }

    return line.replace(/\s+/g, ' ').trim();
  }

  return null;
}

/**
 * Flexible local match: exact, token-subset, initials, first-name-only,
 * reversed "Last, First", and light spelling mistakes.
 */
export function namesBelongToSamePerson(
  registeredName: string,
  resumeName: string,
): boolean {
  const registered = normalizePersonName(registeredName);
  const resume = normalizePersonName(resumeName);
  if (!registered || !resume) {
    return false;
  }
  if (registered === resume) {
    return true;
  }

  const registeredTokens = nameTokens(registered);
  const resumeTokens = nameTokens(resume);
  if (!registeredTokens.length || !resumeTokens.length) {
    return false;
  }

  if (
    orderedTokensCover(registeredTokens, resumeTokens) ||
    orderedTokensCover(resumeTokens, registeredTokens)
  ) {
    return true;
  }

  const registeredFirst = registeredTokens[0];
  const registeredLast = registeredTokens[registeredTokens.length - 1];
  const resumeFirst = resumeTokens[0];
  const resumeLast = resumeTokens[resumeTokens.length - 1];

  // First-name-only account vs resume first name / first initial (+ last name).
  if (registeredTokens.length === 1 && tokensLikelySame(registeredFirst, resumeFirst)) {
    return true;
  }
  if (resumeTokens.length === 1 && tokensLikelySame(resumeFirst, registeredFirst)) {
    return true;
  }

  if (registeredTokens.length >= 2 && resumeTokens.length >= 2) {
    if (
      tokensLikelySame(registeredLast, resumeLast) &&
      tokensLikelySame(registeredFirst, resumeFirst)
    ) {
      return true;
    }

    // "Doe John" vs "John Doe"
    if (
      tokensLikelySame(registeredFirst, resumeLast) &&
      tokensLikelySame(registeredLast, resumeFirst)
    ) {
      return true;
    }
  }

  return false;
}

type GeminiNameMatchResult = {
  samePerson?: boolean;
};

/**
 * Local match first; if that fails, ask Gemini whether the names are the same person
 * (initials, first-name-only, OCR/typos, nicknames).
 */
export async function namesBelongToSamePersonWithAi(
  registeredName: string,
  resumeName: string,
): Promise<boolean> {
  if (namesBelongToSamePerson(registeredName, resumeName)) {
    return true;
  }

  try {
    const result = await generateJson<GeminiNameMatchResult>({
      model: RESUME_GEMINI_MODEL,
      temperature: 0,
      maxOutputTokens: 128,
      systemInstruction: `You verify whether a registered account name and a name extracted from a resume belong to the same person.
Return JSON only: {"samePerson": true} or {"samePerson": false}.

samePerson=true when:
- One side is only a first name and the other has that first name (or its initial) plus a last name.
- One side uses initials for given/family names, e.g. "S T" matches "Sam Thshhbcj", "S. Kumar" matches "Sam Kumar".
- Token order differs ("Doe, John" vs "John Doe") or extra middle names/suffixes are present.
- There are minor spelling mistakes, missing/extra letters, or OCR noise in the same name.
- A clear nickname of the same given name (Sam/Samuel, Mike/Michael). Be conservative.

samePerson=false when:
- Given and family names are clearly different people.
- Both sides include a last name and those last names do not match (even with a shared first name), e.g. "John Smith" vs "John Doe".
- The names are unrelated.`,
      userPrompt: `Registered name: "${registeredName}"
Resume name: "${resumeName}"

Do these reasonably refer to the same person?`,
    });

    const samePerson = result?.samePerson === true;
    logger.info('[resume-name-match] Gemini name comparison', {
      registeredName,
      resumeName,
      samePerson,
    });
    return samePerson;
  } catch (err) {
    logger.warn('[resume-name-match] Gemini name comparison failed', {
      registeredName,
      resumeName,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
