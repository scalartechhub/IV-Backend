import type { CodingLanguageId, CodingLanguageInfo } from "./coding.types";

/** Judge0 CE language IDs — verify against the deployed Judge0 /languages endpoint. */
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

export const CODING_FILE_EXTENSIONS: Record<CodingLanguageId, string> = {
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  java: "java",
  python3: "py",
  javascript: "js",
  typescript: "ts",
  go: "go",
  rust: "rs",
  ruby: "rb",
  php: "php",
  swift: "swift",
  kotlin: "kt",
  dart: "dart",
  scala: "scala",
  racket: "rkt",
  erlang: "erl",
  elixir: "ex",
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

export const DEFAULT_CODE_TEMPLATES: Record<CodingLanguageId, string> = {
  c: `#include <stdio.h>

int main(void) {
    return 0;
}
`,
  cpp: `#include <iostream>
using namespace std;

int main() {
    return 0;
}
`,
  csharp: `using System;

class Program {
    static void Main() {
    }
}
`,
  java: `public class Main {
    public static void main(String[] args) {
    }
}
`,
  python3: `def solution():
    pass


if __name__ == "__main__":
    solution()
`,
  javascript: `function solution() {
}
`,
  typescript: `function solution(): void {
}
`,
  go: `package main

func main() {
}
`,
  rust: `fn main() {
}
`,
  ruby: `def solution
end
`,
  php: `<?php
function solution() {
}
`,
  swift: `import Foundation

func solution() {
}
`,
  kotlin: `fun main() {
}
`,
  dart: `void main() {
}
`,
  scala: `object Main {
  def main(args: Array[String]): Unit = {
  }
}
`,
  racket: `#lang racket

(define (solution)
  )
`,
  erlang: `-module(main).
-export([main/0]).

main() ->
  ok.
`,
  elixir: `defmodule Solution do
  def solution do
  end
end
`,
};

export const ALL_CODING_LANGUAGES = Object.keys(JUDGE0_LANGUAGE_IDS) as CodingLanguageId[];

export const DEFAULT_CODING_LANGUAGES: CodingLanguageId[] = [
  "python3",
  "javascript",
  "typescript",
  "java",
  "cpp",
  "c",
];

export const getJudge0LanguageId = (language: CodingLanguageId): number => {
  const id = JUDGE0_LANGUAGE_IDS[language];
  if (!id) {
    throw new Error(`Unsupported language: ${language}`);
  }
  return id;
};

export const listCodingLanguages = (): CodingLanguageInfo[] =>
  ALL_CODING_LANGUAGES.map((id) => ({
    id,
    label: CODING_LANGUAGE_LABELS[id],
    monacoLanguage: MONACO_LANGUAGE_MAP[id],
    judge0Id: JUDGE0_LANGUAGE_IDS[id],
    fileExtension: CODING_FILE_EXTENSIONS[id],
    defaultTemplate: DEFAULT_CODE_TEMPLATES[id],
  }));
