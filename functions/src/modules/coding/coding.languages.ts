import type { CodingLanguageId } from "./coding.types";

/** Judge0 CE language IDs — aligned with LeetCode-supported languages. */
export const JUDGE0_LANGUAGE_IDS: Record<CodingLanguageId, number> = {
  c: 50,
  cpp: 54,
  csharp: 51,
  java: 62,
  python3: 71,
  javascript: 63,
  typescript: 74,
  go: 60,
  rust: 73,
  ruby: 72,
  php: 68,
  swift: 83,
  kotlin: 78,
  dart: 69,
  scala: 81,
  racket: 55,
  erlang: 58,
  elixir: 57,
};

export const CODING_LANGUAGE_LABELS: Record<CodingLanguageId, string> = {
  c: "C",
  cpp: "C++",
  csharp: "C#",
  java: "Java",
  python3: "Python 3",
  javascript: "JavaScript",
  typescript: "TypeScript",
  go: "Go",
  rust: "Rust",
  ruby: "Ruby",
  php: "PHP",
  swift: "Swift",
  kotlin: "Kotlin",
  dart: "Dart",
  scala: "Scala",
  racket: "Racket",
  erlang: "Erlang",
  elixir: "Elixir",
};

export const ALL_CODING_LANGUAGES = Object.keys(JUDGE0_LANGUAGE_IDS) as CodingLanguageId[];

export const DEFAULT_CODING_LANGUAGES: CodingLanguageId[] = [
  "python3",
  "javascript",
  "java",
  "cpp",
];

export const getJudge0LanguageId = (language: CodingLanguageId): number => {
  const id = JUDGE0_LANGUAGE_IDS[language];
  if (!id) {
    throw new Error(`Unsupported language: ${language}`);
  }
  return id;
};

/** Monaco editor language id per coding language. */
export const MONACO_LANGUAGE_MAP: Record<CodingLanguageId, string> = {
  c: "c",
  cpp: "cpp",
  csharp: "csharp",
  java: "java",
  python3: "python",
  javascript: "javascript",
  typescript: "typescript",
  go: "go",
  rust: "rust",
  ruby: "ruby",
  php: "php",
  swift: "swift",
  kotlin: "kotlin",
  dart: "dart",
  scala: "scala",
  racket: "scheme",
  erlang: "erlang",
  elixir: "elixir",
};
