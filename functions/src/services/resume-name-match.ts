/**
 * Compare the name on an uploaded resume with the signed-in user's registered name.
 */

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
 * Flexible match: exact, token-subset, or shared first+last (incl. "Doe, John").
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

  const registeredTokens = registered.split(' ').filter((token) => token.length > 1);
  const resumeTokens = resume.split(' ').filter((token) => token.length > 1);
  if (!registeredTokens.length || !resumeTokens.length) {
    return false;
  }

  const resumeSet = new Set(resumeTokens);
  const registeredSet = new Set(registeredTokens);

  if (registeredTokens.every((token) => resumeSet.has(token))) {
    return true;
  }
  if (resumeTokens.every((token) => registeredSet.has(token))) {
    return true;
  }

  const overlap = registeredTokens.filter((token) => resumeSet.has(token));
  if (overlap.length >= 2) {
    return true;
  }

  const registeredFirst = registeredTokens[0];
  const registeredLast = registeredTokens[registeredTokens.length - 1];
  const resumeFirst = resumeTokens[0];
  const resumeLast = resumeTokens[resumeTokens.length - 1];

  if (
    registeredTokens.length >= 2 &&
    resumeTokens.length >= 2 &&
    registeredLast === resumeLast &&
    (registeredFirst === resumeFirst ||
      registeredFirst[0] === resumeFirst[0] ||
      resumeFirst === registeredLast ||
      resumeLast === registeredFirst)
  ) {
    return true;
  }

  // "Doe John" vs "John Doe"
  if (
    registeredTokens.length >= 2 &&
    resumeTokens.length >= 2 &&
    registeredFirst === resumeLast &&
    registeredLast === resumeFirst
  ) {
    return true;
  }

  return false;
}
