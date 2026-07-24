const path = require("path");
const admin = require(path.join(__dirname, "../functions/node_modules/firebase-admin"));

const serviceAccountPath = path.resolve(__dirname, "../firebase-service-account.json");
const serviceAccount = require(serviceAccountPath);

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

const DEFAULT_STARTERS = {
  python3: `# Read input, implement solution, print output
import sys

def solve():
    # TODO: implement
    pass

if __name__ == "__main__":
    solve()
`,
  javascript: `// Read from stdin, implement solution, write to stdout
const fs = require("fs");

function solve() {
  // TODO: implement
}

solve();
`,
  java: `import java.util.*;
import java.io.*;

public class Main {
  public static void main(String[] args) throws Exception {
    BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
    // TODO: implement
  }
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  // TODO: implement
  return 0;
}
`,
};

const problems = [
  {
    id: "two-sum",
    title: "Two Sum",
    difficulty: "Easy",
    category: "Arrays",
    tags: ["Arrays", "Hash Table"],
    acceptance: 92,
    order: 1,
    description:
      "Given an array of integers `nums` and an integer `target`, return indices of the two numbers such that they add up to `target`.\n\nYou may assume that each input would have exactly one solution, and you may not use the same element twice.",
    constraints: [
      "2 <= nums.length <= 10^4",
      "-10^9 <= nums[i] <= 10^9",
      "-10^9 <= target <= 10^9",
      "Only one valid answer exists.",
    ],
    examples: [
      {
        input: "2 7 11 15\n9",
        output: "0 1",
        explanation: "Because nums[0] + nums[1] == 9, we return [0, 1].",
      },
      {
        input: "3 2 4\n6",
        output: "1 2",
      },
    ],
    hints: [
      "A brute force approach checks every pair — O(n²).",
      "Can you use a hash map to store seen values and their indices?",
      "For each number x, check if target - x was seen before.",
    ],
    solution: {
      explanation:
        "Use a hash map to store each value and its index. For each element, if complement exists in the map, return both indices.",
      codeByLanguage: {
        python3: `import sys

def solve():
    lines = sys.stdin.read().strip().split("\\n")
    nums = list(map(int, lines[0].split()))
    target = int(lines[1])
    seen = {}
    for i, n in enumerate(nums):
        if target - n in seen:
            print(seen[target - n], i)
            return
        seen[n] = i

if __name__ == "__main__":
    solve()
`,
      },
    },
    starterCode: {
      ...DEFAULT_STARTERS,
      python3: `import sys

def solve():
    lines = sys.stdin.read().strip().split("\\n")
    nums = list(map(int, lines[0].split()))
    target = int(lines[1])
    # TODO: return indices of two numbers that sum to target
    pass

if __name__ == "__main__":
    solve()
`,
    },
    publicTests: [
      { input: "2 7 11 15\n9", expectedOutput: "0 1" },
      { input: "3 2 4\n6", expectedOutput: "1 2" },
    ],
    hiddenTests: [{ input: "3 3\n6", expectedOutput: "0 1" }],
  },
  {
    id: "valid-parentheses",
    title: "Valid Parentheses",
    difficulty: "Easy",
    category: "Stack",
    tags: ["Stack", "String"],
    acceptance: 95,
    order: 2,
    description:
      "Given a string `s` containing just the characters `'('`, `')'`, `'{'`, `'}'`, `'['` and `']'`, determine if the input string is valid.\n\nAn input string is valid if open brackets are closed in the correct order.",
    constraints: ["1 <= s.length <= 10^4", "s consists of parentheses only."],
    examples: [
      { input: "()", output: "true" },
      { input: "([{}])", output: "true" },
      { input: "(]", output: "false" },
    ],
    hints: [
      "Use a stack to track opening brackets.",
      "When you see a closing bracket, the top of the stack must match.",
      "The string is valid if the stack is empty at the end.",
    ],
    solution: {
      explanation: "Push opening brackets; pop and match on closing brackets.",
      codeByLanguage: {
        python3: `import sys

def solve():
    s = sys.stdin.read().strip()
    stack = []
    pairs = {")": "(", "}": "{", "]": "["}
    for ch in s:
        if ch in "({[":
            stack.append(ch)
        elif not stack or stack.pop() != pairs[ch]:
            print("false")
            return
    print("true" if not stack else "false")

if __name__ == "__main__":
    solve()
`,
      },
    },
    starterCode: {
      ...DEFAULT_STARTERS,
      python3: `import sys

def solve():
    s = sys.stdin.read().strip()
    # TODO: print "true" or "false"
    pass

if __name__ == "__main__":
    solve()
`,
    },
    publicTests: [
      { input: "()", expectedOutput: "true" },
      { input: "([{}])", expectedOutput: "true" },
      { input: "(]", expectedOutput: "false" },
    ],
    hiddenTests: [{ input: "([)]", expectedOutput: "false" }],
  },
  {
    id: "longest-substring",
    title: "Longest Substring Without Repeating",
    difficulty: "Medium",
    category: "Sliding Window",
    tags: ["Sliding Window", "Hash Table"],
    acceptance: 78,
    order: 3,
    description:
      "Given a string `s`, find the length of the longest substring without repeating characters.",
    constraints: ["0 <= s.length <= 5 * 10^4", "s consists of English letters, digits, symbols."],
    examples: [
      { input: "abcabcbb", output: "3", explanation: "The answer is 'abc' with length 3." },
      { input: "bbbbb", output: "1" },
    ],
    hints: [
      "Use two pointers to represent the current window.",
      "Track characters in the window with a set or map.",
      "Shrink the window when a duplicate is found.",
    ],
    solution: {
      explanation: "Sliding window with a map of last seen indices.",
      codeByLanguage: {
        python3: `import sys

def solve():
    s = sys.stdin.read().strip()
    last = {}
    start = 0
    best = 0
    for i, ch in enumerate(s):
        if ch in last and last[ch] >= start:
            start = last[ch] + 1
        last[ch] = i
        best = max(best, i - start + 1)
    print(best)

if __name__ == "__main__":
    solve()
`,
      },
    },
    starterCode: {
      ...DEFAULT_STARTERS,
      python3: `import sys

def solve():
    s = sys.stdin.read().strip()
    # TODO: print length of longest substring without repeating chars
    pass

if __name__ == "__main__":
    solve()
`,
    },
    publicTests: [
      { input: "abcabcbb", expectedOutput: "3" },
      { input: "bbbbb", expectedOutput: "1" },
    ],
    hiddenTests: [{ input: "pwwkew", expectedOutput: "3" }],
  },
  {
    id: "lru-cache",
    title: "LRU Cache",
    difficulty: "Medium",
    category: "Design",
    tags: ["Design", "Hash Table", "Linked List"],
    acceptance: 70,
    order: 4,
    description:
      "Design a data structure that follows the constraints of a Least Recently Used (LRU) cache.\n\nInput format: first line `capacity`, then operations `PUT key value` or `GET key`. Print GET results (or -1) each line.",
    constraints: ["1 <= capacity <= 3000", "At most 2 * 10^5 operations"],
    examples: [
      {
        input: "2\nPUT 1 1\nPUT 2 2\nGET 1\nPUT 3 3\nGET 2\nGET 3",
        output: "1\n-1\n3",
      },
    ],
    hints: [
      "Use a hash map for O(1) lookup.",
      "Track usage order — OrderedDict in Python works well.",
      "On GET or PUT, move the key to most-recent.",
    ],
    solution: {
      explanation: "OrderedDict gives O(1) move-to-end and eviction of oldest.",
      codeByLanguage: {
        python3: `import sys
from collections import OrderedDict

def solve():
    lines = sys.stdin.read().strip().split("\\n")
    cap = int(lines[0])
    cache = OrderedDict()
    out = []
    for line in lines[1:]:
        parts = line.split()
        if parts[0] == "PUT":
            k, v = int(parts[1]), int(parts[2])
            if k in cache:
                del cache[k]
            cache[k] = v
            if len(cache) > cap:
                cache.popitem(last=False)
        else:
            k = int(parts[1])
            if k not in cache:
                out.append("-1")
            else:
                v = cache.pop(k)
                cache[k] = v
                out.append(str(v))
    print("\\n".join(out))

if __name__ == "__main__":
    solve()
`,
      },
    },
    starterCode: {
      ...DEFAULT_STARTERS,
      python3: `import sys

def solve():
    lines = sys.stdin.read().strip().split("\\n")
    cap = int(lines[0])
    # TODO: process PUT/GET operations, print GET results
    pass

if __name__ == "__main__":
    solve()
`,
    },
    publicTests: [
      {
        input: "2\nPUT 1 1\nPUT 2 2\nGET 1\nPUT 3 3\nGET 2\nGET 3",
        expectedOutput: "1\n-1\n3",
      },
    ],
    hiddenTests: [
      {
        input: "1\nPUT 2 1\nGET 2\nPUT 3 2\nGET 2\nGET 3",
        expectedOutput: "1\n-1\n2",
      },
    ],
  },
  {
    id: "merge-k-lists",
    title: "Merge k Sorted Lists",
    difficulty: "Hard",
    category: "Heap",
    tags: ["Heap", "Linked List", "Divide and Conquer"],
    acceptance: 61,
    order: 5,
    description:
      "You are given an array of k linked lists, each sorted in ascending order. Merge all into one sorted list.\n\nInput: first line k, then k lines of space-separated sorted integers (empty line = empty list). Output: merged sorted numbers space-separated.",
    constraints: ["k == lists.length", "0 <= k <= 10^4"],
    examples: [
      {
        input: "3\n1 4 5\n1 3 4\n2 6",
        output: "1 1 2 3 4 4 5 6",
      },
    ],
    hints: [
      "Compare the heads of all lists — a min-heap helps.",
      "Push the first element of each list into a heap.",
      "Pop smallest, append to result, push next from that list.",
    ],
    solution: {
      explanation: "Min-heap over current heads of each list.",
      codeByLanguage: {
        python3: `import sys
import heapq

def solve():
    lines = sys.stdin.read().strip().split("\\n")
    k = int(lines[0])
    lists = []
    for i in range(1, k + 1):
        if i < len(lines) and lines[i].strip():
            lists.append(list(map(int, lines[i].split())))
        else:
            lists.append([])
    heap = []
    for li, arr in enumerate(lists):
        if arr:
            heapq.heappush(heap, (arr[0], li, 0))
    out = []
    while heap:
        val, li, idx = heapq.heappop(heap)
        out.append(str(val))
        nxt = idx + 1
        if nxt < len(lists[li]):
            heapq.heappush(heap, (lists[li][nxt], li, nxt))
    print(" ".join(out))

if __name__ == "__main__":
    solve()
`,
      },
    },
    starterCode: {
      ...DEFAULT_STARTERS,
      python3: `import sys

def solve():
    lines = sys.stdin.read().strip().split("\\n")
    k = int(lines[0])
    # TODO: merge k sorted lists and print result
    pass

if __name__ == "__main__":
    solve()
`,
    },
    publicTests: [
      { input: "3\n1 4 5\n1 3 4\n2 6", expectedOutput: "1 1 2 3 4 4 5 6" },
    ],
    hiddenTests: [{ input: "1\n1 2 3", expectedOutput: "1 2 3" }],
  },
  {
    id: "word-ladder",
    title: "Word Ladder",
    difficulty: "Hard",
    category: "BFS",
    tags: ["BFS", "Graph"],
    acceptance: 55,
    order: 6,
    description:
      "Given two words `beginWord` and `endWord`, and a dictionary `wordList`, return the number of words in the shortest transformation sequence from `beginWord` to `endWord`, or 0 if no sequence exists.\n\nInput: line 1 beginWord, line 2 endWord, line 3+ dictionary words.",
    constraints: ["1 <= beginWord.length <= 10", "endWord differs from beginWord"],
    examples: [
      {
        input: "hit\ncog\nhot\ndot\ndog\nlot\nlog\ncog",
        output: "5",
        explanation: "hit → hot → dot → dog → cog",
      },
    ],
    hints: [
      "Treat words as nodes; edges connect words differing by one letter.",
      "BFS finds the shortest path.",
      "Generate neighbors by changing each character.",
    ],
    solution: {
      explanation: "BFS from beginWord; explore one-letter mutations in wordList.",
      codeByLanguage: {
        python3: `import sys
from collections import deque

def solve():
    lines = sys.stdin.read().strip().split("\\n")
    begin, end = lines[0], lines[1]
    words = set(lines[2:])
    if end not in words:
        print(0)
        return
    q = deque([(begin, 1)])
    visited = {begin}
    while q:
        word, depth = q.popleft()
        if word == end:
            print(depth)
            return
        for i in range(len(word)):
            for c in "abcdefghijklmnopqrstuvwxyz":
                nxt = word[:i] + c + word[i + 1:]
                if nxt in words and nxt not in visited:
                    visited.add(nxt)
                    q.append((nxt, depth + 1))
    print(0)

if __name__ == "__main__":
    solve()
`,
      },
    },
    starterCode: {
      ...DEFAULT_STARTERS,
      python3: `import sys

def solve():
    lines = sys.stdin.read().strip().split("\\n")
    begin, end = lines[0], lines[1]
    words = set(lines[2:])
    # TODO: print shortest transformation length or 0
    pass

if __name__ == "__main__":
    solve()
`,
    },
    publicTests: [
      { input: "hit\ncog\nhot\ndot\ndog\nlot\nlog\ncog", expectedOutput: "5" },
    ],
    hiddenTests: [{ input: "a\nb\na\nb", expectedOutput: "2" }],
  },
];

const ALL_LANGUAGES = [
  "cpp",
  "java",
  "python3",
  "c",
  "csharp",
  "javascript",
  "typescript",
  "php",
  "swift",
  "kotlin",
  "dart",
  "go",
  "ruby",
  "scala",
  "rust",
  "racket",
  "erlang",
  "elixir",
];

async function seedCodingProblems() {
  console.log("Seeding coding problems...");

  for (const problem of problems) {
    const { hiddenTests, ...publicDoc } = problem;
    const doc = {
      ...publicDoc,
      supportedLanguages: ALL_LANGUAGES,
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      isActive: true,
    };

    await db.collection("codingProblems").doc(problem.id).set(doc, { merge: true });
    await db.collection("codingProblemSecrets").doc(problem.id).set({
      problemId: problem.id,
      hiddenTests,
    });
    console.log(`  ✓ ${problem.id}`);
  }

  console.log("Done seeding coding problems.");
}

seedCodingProblems().catch((err) => {
  console.error(err);
  process.exit(1);
});
