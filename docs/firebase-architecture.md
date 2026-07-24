# AllInterviewPro — Firebase Backend Architecture

Stack: Angular 20 (Standalone, Signals) · Firebase Auth · Firestore · Storage · Cloud Functions · Gemini Live API

Based on: Dashboard, Career Progress, Job Portal, Settings, Practice Interviews, Coding Interviews, Resume Analysis, Learning Roadmap, Reports, Achievements screens.

---

## 0. Design principles (read first)

1. **Denormalize aggressively for reads, normalize for writes.** The dashboard, career progress, and reports pages all read the *same* underlying numbers (readiness %, skill scores, streak, XP). Compute these once when an interview finishes, store the result on `users/{uid}`, and every screen just reads that one cheap document. Never recompute aggregates on page load.
2. **One `interviews` collection, not three.** Your doc asks for separate "Practice Interview," "Coding Interview," and "Interview Session" collections. In practice these are the *same lifecycle* (start → conduct → score → report) with a `mode` field distinguishing them. Splitting them means duplicating the scoring/XP/streak pipeline three times and querying three collections for "recent activity." Use `interviews/{interviewId}` with `mode: "conversational" | "coding" | "behavioral"`, and put mode-specific data in a nested `codingData` / `conversationData` object. This is the single biggest scalability decision in this doc — see §12.
3. **Transcripts and heavy conversation data live in a subcollection**, not inline on the interview doc. A 45-minute Gemini Live transcript can be hundreds of KB; Firestore docs cap at 1MB and you don't want to pay to re-download the transcript every time you list "recent interviews."
4. **Firestore stores facts and derived scores. Gemini Live context stays ephemeral** — session-only conversational state is never persisted verbatim; only the *outcome* (summary, scores, key moments) is written back.
5. **Every write that changes XP/streak/skills goes through one Cloud Function** (`onInterviewComplete`), triggered by a Firestore `onUpdate` when `status` transitions to `"completed"`. This keeps the "fan-out" logic in one place instead of scattered across client calls.

---

## 1. Authentication & User Model

### `users/{uid}`
Mirrors Firebase Auth (`uid`, `email`) plus everything the Dashboard header, Settings, and Career Progress pages need on every load.

```ts
interface UserDoc {
  uid: string;
  email: string;
  displayName: string;                 // "Ajay Kumar"
  photoURL?: string;
  provider: 'password' | 'google' | 'github';
  createdAt: Timestamp;
  lastLoginAt: Timestamp;

  // Profile (Settings > Profile card)
  profile: {
    currentRole: string;               // "Angular Developer"
    yearsExperience: number;           // 3
    targetRole: string;                // "Senior Angular Engineer"
    targetCompanies: string[];         // ["Google","Stripe","Razorpay"]
    location: string;                  // for salary insights, "India"
  };

  // Gamification (Dashboard header, sidebar widget)
  gamification: {
    level: number;                     // 2
    levelName: string;                 // "Developer"
    currentXP: number;                 // 1240
    xpToNextLevel: number;             // 2000
    streakCount: number;               // 7
    lastActiveDate: string;            // "2026-07-24" (YYYY-MM-DD, for streak calc)
    longestStreak: number;             // 12 (Achievements page)
  };

  // Derived readiness (computed by Cloud Function, never client-written)
  readiness: {
    score: number;                     // 82
    deltaWeek: number;                 // +6
    percentileVsRole: number;          // 82 ("ahead of 82% of Angular Devs")
    lastComputedAt: Timestamp;
  };

  // Coaching preferences (Settings > Coaching preferences)
  preferences: {
    dailyReminders: boolean;
    aiVoiceFeedback: boolean;
    focusMode: boolean;                // hide streak/XP during interviews
    weeklyProgressEmail: boolean;
    darkMode: boolean;
  };

  subscription: {
    plan: 'free' | 'pro' | 'team';
    renewsAt?: Timestamp;
  };
}
```

- **Indexes:** none needed beyond default single-field (uid is the doc ID).
- **Security rule:** `allow read, write: if request.auth.uid == uid;` — but `gamification.*` and `readiness.*` should ONLY be writable by Cloud Functions (Admin SDK bypasses rules). Add a rule that rejects client writes to those specific fields:
```
match /users/{uid} {
  allow read: if request.auth.uid == uid;
  allow update: if request.auth.uid == uid
    && !('gamification' in request.resource.data.diff(resource.data).affectedKeys())
    && !('readiness' in request.resource.data.diff(resource.data).affectedKeys());
}
```
- **Never client-writable:** `gamification`, `readiness` — these are attack surface for XP fraud if left open.

---

## 2. Resume Collection

Supports multiple versions (Resume Analysis page shows "v4"), one active at a time.

### `users/{uid}/resumes/{resumeId}`
```ts
interface ResumeDoc {
  fileName: string;               // "Ajay_Kumar_Resume_v4.pdf"
  storagePath: string;            // resumes/{uid}/{resumeId}.pdf
  version: number;                // 4
  isActive: boolean;              // only one true per user — enforce in Cloud Function
  uploadedAt: Timestamp;
  targetRole: string;             // "Senior Angular Engineer · 5+ yrs"

  analysis: {
    overallScore: number;         // 76
    atsScore: number;             // 82
    impactScore: number;          // 71
    clarityScore: number;         // 78
    keywordMatch: { score: number; delta: number };   // 82, +5
    quantifiedImpact: { score: number; delta: number }; // 64, -2
    actionVerbs: { score: number; delta: number };
    structureLength: { score: number; delta: number };
    percentileVsPeers: number;    // 68

    fixesFirst: Array<{ id: string; severity: 'high'|'medium'|'low'; text: string }>;
    workingWell: Array<{ id: string; text: string }>;

    extractedKeywords: string[];
    missingKeywords: string[];    // "RxJS","SSR","Micro-frontends"
    recommendedSkills: string[];
    recommendedInterviewIds: string[];  // links into recommendations
  };

  aiReviewedAt: Timestamp;
  analysisStatus: 'pending' | 'processing' | 'completed' | 'failed';
}
```
- **Indexes:** composite `(isActive ASC, uploadedAt DESC)` per user (automatic since it's a subcollection query scoped to one user — still declare it if you query across `collectionGroup('resumes')` for admin analytics).
- **Storage, not Firestore:** the actual PDF/DOCX bytes — see §11.
- **Relationships:** `resumes/{id}` → referenced by `interviews/{id}.resumeVersionUsed` (so you know exactly which resume version informed a given interview's questions).
- **Never updated after creation:** `fileName`, `storagePath`, `version` — immutable once uploaded; a "new version" is a new document, not an edit.

---

## 3. Interviews Collection (unified — replaces "Practice/Coding/Interview Session")

This is the core collection. One document per attempt, regardless of mode.

### `interviews/{interviewId}`  *(top-level, not a subcollection — needed for collectionGroup queries like leaderboards/weekly rank)*
```ts
type InterviewMode = 'conversational' | 'coding' | 'behavioral' | 'system_design';
type InterviewStatus = 'created' | 'device_check' | 'in_progress' | 'completed' | 'abandoned' | 'expired';

interface InterviewDoc {
  userId: string;
  mode: InterviewMode;
  status: InterviewStatus;

  // Setup (Quick Start / Filters selections)
  config: {
    topic?: string;                 // "RxJS + State Management"
    company?: string;               // "Google" (Company preparation cards)
    skills: string[];               // selected skills
    technologies: string[];         // selected tech
    difficulty: 'easy' | 'medium' | 'hard';
    durationMinutes: number;        // selected duration; interview auto-ends at this mark
    resumeVersionUsed?: string;     // resumeId, so Gemini context is reproducible
    currentRole: string;
    targetRole: string;
  };

  // Timing
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  durationSec?: number;             // actual elapsed, vs config.durationMinutes planned
  autoEnded: boolean;               // true if it hit the time limit rather than user-ended

  // Gemini Live session metadata (not the transcript itself — see conversations subcollection)
  aiSession: {
    geminiSessionId: string;
    modelVersion: string;           // e.g. "gemini-live-2.5"
    tokenUsage: { input: number; output: number; total: number };
    estimatedCostUsd: number;
    connectionQuality: 'good' | 'fair' | 'poor';
    reconnectCount: number;
  };

  // Device/environment (Device Check step)
  environment: {
    audioEnabled: boolean;
    cameraEnabled: boolean;
    browser: string;                // "Chrome 126"
    os: string;
    internetQualityMbps: number;
  };

  // Scoring — populated by onInterviewComplete Cloud Function
  results?: {
    overallScore: number;           // 78
    technicalScore: number;
    communicationScore: number;
    confidenceScore: number;
    problemSolvingScore: number;
    codingScore?: number;
    behaviorScore?: number;
    skillDeltas: Record<string, number>;  // { technical: +2, coding: +4, ... }
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
    nextLearningPathId?: string;
  };

  xpEarned: number;                 // 120
  reportId?: string;                // FK to reports/{reportId} once generated

  // Mode-specific nested data
  codingData?: {
    problemIds: string[];
    submissionIds: string[];        // FKs to interviews/{id}/submissions
    passRate: number;
  };

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `interviews/{interviewId}/conversation/{turnId}`  *(subcollection — transcript, chunked)*
```ts
interface ConversationTurn {
  turnIndex: number;
  speaker: 'ai' | 'user';
  timestampOffsetMs: number;        // relative to interview start
  text: string;                     // transcribed text (not raw audio)
  audioStoragePath?: string;        // only if you choose to persist audio — see §10
  sentiment?: 'confident' | 'neutral' | 'hesitant';
  questionType?: 'technical' | 'behavioral' | 'follow_up' | 'clarifying';
}
```
- Store in batches of ~20 turns per doc (or one doc per turn if you need fine-grained realtime rendering) — don't put the whole transcript as one giant array field on the parent doc; it'll blow past the 1MB limit on long interviews and forces a full doc rewrite on every turn.
- **Indexes:** `(turnIndex ASC)` — default, no composite needed.
- **Retention:** consider a TTL/lifecycle policy (see §12) — raw transcripts are rarely read after the report is generated; archive to Storage as a compressed JSON after 30-90 days and delete the subcollection to cut Firestore storage cost.

### `interviews/{interviewId}/submissions/{submissionId}`  *(coding mode only)*
```ts
interface CodingSubmission {
  problemId: string;                // FK to codingProblems/{id}
  code: string;
  language: string;
  submittedAt: Timestamp;
  status: 'passed' | 'failed' | 'partial' | 'runtime_error';
  testsPassed: number;
  testsTotal: number;
  runtimeMs?: number;
  aiCodeReview?: {
    summary: string;
    suggestions: string[];
  };
}
```

- **Indexes needed on `interviews`:**
  - `(userId ASC, status ASC, completedAt DESC)` — "recent completed interviews" list
  - `(userId ASC, mode ASC, completedAt DESC)` — Practice vs Coding tab filtering
  - `(config.company ASC, completedAt DESC)` — collectionGroup, for company leaderboards/weekly rank (`#124 Weekly rank` on Coding Interviews page)
- **Security:** `allow read, write: if request.auth.uid == resource.data.userId` for the parent; subcollections inherit via `get()` lookup or duplicate `userId` on each turn doc for cheaper rule evaluation (duplicating avoids an extra `get()` read per rule check, which Firestore bills for).
- **Duplicate:** `userId` onto every subcollection doc (cheap, avoids extra reads in security rules and lets you use `collectionGroup` queries scoped by user).
- **Never updated after completion:** `results`, `xpEarned`, `startedAt` — completed interviews are immutable; a re-attempt is a new document.

---

## 4. Reports Collection

The Reports page (skill trends, radar, hiring probability, heatmap) reads **aggregated weekly rollups**, not raw interviews — recomputing 6 weeks of line charts from scratch on every page load is expensive at scale.

### `users/{uid}/reports/{reportId}`  *(one per interview — the downloadable/reviewable report)*
```ts
interface ReportDoc {
  interviewId: string;
  generatedAt: Timestamp;
  summary: string;                  // 2-3 sentence AI summary
  charts: {
    skillBreakdown: Record<string, number>;
    timeline: Array<{ label: string; score: number }>;
  };
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  pdfStoragePath?: string;          // generated on demand, cached here once built
  comparedToPreviousReportId?: string;  // for "historical comparison"
}
```

### `users/{uid}/weeklyStats/{weekStart}`  *(pre-aggregated — powers Skill trends / radar / heatmap charts cheaply)*
```ts
interface WeeklyStatsDoc {
  weekStart: string;                // "2026-07-20"
  technical: number; communication: number; confidence: number;
  problemSolving: number; coding: number; behavior: number;
  hiringProbability: number;
  interviewsCompleted: number;
  practiceMinutes: number;
  practiceMinutesByDay: Record<string, number>;  // { mon: 45, tue: 60, ... }
}
```
- Written incrementally by `onInterviewComplete` (increment fields), not recomputed by scanning `interviews`.
- **Indexes:** `(weekStart ASC)` default — query last 6-12 docs for chart ranges.
- **Cache this client-side** (Angular signal + IndexedDB or just in-memory) since it changes at most once per interview, not per page load.

---

## 5. Achievements Collection

### `achievementsCatalog/{achievementId}`  *(top-level, shared, admin-managed — not per-user)*
```ts
interface AchievementCatalogDoc {
  name: string;                     // "Consistency King"
  description: string;              // "7 day streak"
  icon: string;
  category: 'streak' | 'interview' | 'coding' | 'communication' | 'milestone';
  rule: { type: 'streak_gte' | 'interviews_gte' | 'score_gte' | 'problems_gte'; value: number };
  totalCount: number;                // "6 of 24 unlocked" needs the catalog size — cache this on client
}
```

### `users/{uid}/achievements/{achievementId}`  *(doc ID = achievementId, existence = unlocked)*
```ts
interface UserAchievementDoc {
  unlockedAt: Timestamp;
  seen: boolean;                    // for "unlocked 3 this week" notification badge
  progressSnapshot?: number;        // e.g. 45 (for "Focused Mind — 45 min deep session")
}
```
- "Coming up" locked achievements = `achievementsCatalog` docs NOT present in `users/{uid}/achievements` — computed client-side by diffing the two small collections (24 total catalog docs, cheap to fetch in full and cache).
- **Indexes:** `(unlockedAt DESC)` for "recently unlocked."
- **Security:** catalog is `allow read: if true; allow write: if false` (admin SDK only). User achievements: `allow write: if false` client-side — only Cloud Functions unlock achievements, never the client (prevents trophy fraud).

---

## 6. Learning Roadmap Collection

### `users/{uid}/roadmap/{roadmapId}`  *(usually one active roadmap; regenerated = new doc or versioned)*
```ts
interface RoadmapDoc {
  title: string;                    // "Your 4-week path to Senior Angular"
  targetRole: string;
  generatedAt: Timestamp;
  generatedFrom: 'interview_performance' | 'manual_regenerate';
  isActive: boolean;
  weeks: Array<{
    weekNumber: number;
    theme: string;                  // "RxJS & State"
    unlocked: boolean;               // weeks 3&4 locked until progress
    percentComplete: number;
    activities: Array<{
      id: string;
      title: string;
      type: 'video' | 'reading' | 'practice' | 'project' | 'interview';
      estMinutes: number;
      status: 'pending' | 'in_progress' | 'done';
      linkedInterviewId?: string;    // if type is 'interview'
    }>;
  }>;
}
```
- **Indexes:** `(isActive ASC, generatedAt DESC)`.
- Regeneration ("Regenerate" button) calls a Cloud Function → Gemini generates new roadmap JSON → written as a new doc, old one archived (`isActive: false`) rather than deleted, so you can show "what changed."

---

## 7. Career Progress Collection

This page is almost entirely **derived/aggregated data** — most fields already live on `users/{uid}.readiness` and `weeklyStats`. Only genuinely new data:

### `users/{uid}/careerProgress/current`  *(singleton doc)*
```ts
interface CareerProgressDoc {
  salaryInsights: {
    currency: string;               // "INR"
    expectedRangeMin: number;       // 1800000
    expectedRangeMax: number;       // 2200000
    positionInRange: number;        // 0-1, where the fill-bar sits
    mostRequestedSkill: string;     // "Angular Signals"
    fastestImprovingSkill: { name: string; deltaPercent: number };
  };
  peerBenchmark: {
    cohortLabel: string;            // "Angular developers targeting Google, Amazon & Stripe"
    cohortSize: number;             // 4812
    scores: Record<string, { you: number; peerAvg: number }>;
  };
  milestones: Array<{
    id: string;
    title: string;                  // "Complete 5 system design interviews"
    targetValue: number;
    currentValue: number;           // percentComplete derived = current/target
    unlocksLevel: string;           // "Senior Developer"
  }>;
  lastComputedAt: Timestamp;
}
```
- Regenerated by a **scheduled Cloud Function** (nightly) that recomputes peer percentiles across the user base — this is the one page where you're comparing against *other users*, so it can't be computed synchronously on a single write. A nightly batch job aggregating `interviews` collectionGroup by role/company cohort is the standard pattern.
- **Never client-writable** — entirely server-computed.

---

## 8. Notifications Collection

### `users/{uid}/notifications/{notificationId}`
```ts
interface NotificationDoc {
  type: 'reminder' | 'achievement_unlocked' | 'streak_risk' | 'report_ready' | 'job_match' | 'system';
  title: string;
  body: string;
  read: boolean;
  createdAt: Timestamp;
  actionUrl?: string;               // deep link, e.g. /achievements
  relatedId?: string;               // achievementId, interviewId, etc.
}
```
- **Indexes:** `(read ASC, createdAt DESC)` — unread-count badge query.
- Use Firestore's real-time listener on this subcollection (small, cheap) to drive the bell icon badge — don't poll.
- **TTL:** auto-delete read notifications older than 30 days via scheduled function to keep the collection small.

---

## 9. Settings Collection

Mostly already covered by `users/{uid}.preferences` and `users/{uid}.profile` (§1) — no separate collection needed. Keeping settings on the user doc means one read populates the whole Settings page and every other page that needs `darkMode`/`focusMode`. **Don't create a separate `settings` collection** — it would just mean two reads instead of one for pages that need both profile and prefs.

---

## 10. Job Applications / Job Portal Collection

Page is "coming soon" but sneak-peek cards imply matching logic already exists.

### `jobListings/{jobId}`  *(top-level, shared across users — admin/scraper-populated)*
```ts
interface JobListingDoc {
  company: string; role: string; location: string;
  salaryMin: number; salaryMax: number; currency: string;
  remote: boolean;
  requiredSkills: string[];
  postedAt: Timestamp;
  active: boolean;
}
```

### `users/{uid}/jobMatches/{jobId}`  *(doc ID = jobId — precomputed match score, not calculated at read time)*
```ts
interface JobMatchDoc {
  matchPercent: number;             // 92
  matchedSkills: string[];
  computedAt: Timestamp;
}
```

### `users/{uid}/applications/{applicationId}`  *(for when the feature ships)*
```ts
interface ApplicationDoc {
  jobId: string;
  status: 'saved' | 'applied' | 'interviewing' | 'offer' | 'rejected';
  appliedAt?: Timestamp;
  notifyOnLaunch: boolean;          // "Notify me" button state
}
```
- **Indexes:** `jobListings`: `(active ASC, postedAt DESC)`. `jobMatches`: `(matchPercent DESC)` for sorted sneak-peek cards.
- Match scores computed by a scheduled function (nightly, per active user against active listings) — never on-demand per page load at 1M-user scale.

---

## 11. Coding Interview Collection (problem bank)

Separate from `interviews` — this is a **shared catalog**, not per-user.

### `codingProblems/{problemId}`  *(top-level, shared)*
```ts
interface CodingProblemDoc {
  title: string;                    // "Two Sum"
  category: string;                 // "Arrays"
  difficulty: 'easy' | 'medium' | 'hard';
  acceptanceRate: number;           // 92
  description: string;
  starterCode: Record<string, string>;   // per language
  testCases: Array<{ input: string; expectedOutput: string; hidden: boolean }>;
  tags: string[];
}
```

### `users/{uid}/problemProgress/{problemId}`  *(doc ID = problemId)*
```ts
interface ProblemProgressDoc {
  status: 'unsolved' | 'solved' | 'attempted';
  bestSubmissionId?: string;        // FK into interviews/{id}/submissions
  solvedAt?: Timestamp;
  attempts: number;
}
```
- Weekly rank (`#124`) and streak/solved counts on the Coding Interviews page = fields already on `users/{uid}.gamification` + a `codingStreak` counter — don't build a separate leaderboard collection until you actually need a public leaderboard; if you do, precompute it nightly into `leaderboards/weekly/{uid}` rather than querying/sorting all users live.
- **Indexes:** `codingProblems`: `(category ASC, difficulty ASC)` for filter tabs. `problemProgress`: `(status ASC)`.
- **Never client-writable:** `codingProblems` catalog (admin only).

---

## 12. Bookmarks, Analytics, Feedback, AI Prompt History

### `users/{uid}/bookmarks/{itemId}`
```ts
interface BookmarkDoc {
  itemType: 'question' | 'codingProblem' | 'roadmapActivity' | 'company';
  itemId: string;
  title: string;                    // denormalized for list rendering without a join
  bookmarkedAt: Timestamp;
}
```

### `analyticsEvents/{eventId}`  *(top-level, write-heavy — DO NOT read this back into the app)*
```ts
interface AnalyticsEventDoc {
  userId: string;
  eventType: string;                // "interview_started", "resume_uploaded", ...
  metadata: Record<string, any>;
  timestamp: Timestamp;
}
```
- **Critical for scale:** never query this collection from the client. Stream it to **BigQuery via the Firestore-BigQuery Cloud Function extension** and do all analytics there. At 1M users, an events collection queried directly in Firestore is a billing and index nightmare. This collection exists only as a write sink.

### `users/{uid}/feedback/{feedbackId}`
```ts
interface FeedbackDoc {
  interviewId?: string;
  rating: number;                   // 1-5
  comment?: string;
  category: 'ai_quality' | 'bug' | 'feature_request' | 'general';
  submittedAt: Timestamp;
}
```

### `interviews/{interviewId}/aiPromptLog/{logId}`  *(optional — debugging/audit only, NOT user-facing)*
```ts
interface AiPromptLogDoc {
  promptType: 'question_generation' | 'scoring' | 'follow_up';
  contextSummary: string;           // don't store the full prompt with resume PII repeatedly
  modelResponse: string;
  latencyMs: number;
  timestamp: Timestamp;
}
```
- Only enable this in a `dev`/`staging` project, or gate behind a feature flag — logging every Gemini prompt/response for 1M users' interviews is a massive, mostly-useless storage cost. Sample it (e.g. 1% of sessions) if you need it for prompt-quality monitoring.

---

## Firebase Storage structure

```
/resumes/{uid}/{resumeId}.pdf
/reports/{uid}/{reportId}.pdf                    # generated on-demand, cached
/avatars/{uid}/profile.jpg
/coding-submissions/{uid}/{interviewId}/{submissionId}.txt   # optional, only if code isn't stored inline
/voice-recordings/{uid}/{interviewId}/            # ONLY if you decide to keep audio — see below
/screenshots/{uid}/{interviewId}/{turnId}.jpg     # device-check / proctoring, if used
/attachments/{uid}/{feedbackId}/                  # bug report screenshots etc.
```
- Storage security rules mirror Firestore: `allow read, write: if request.auth.uid == uid` on every path segment.
- Resume/report PDFs: set `Cache-Control` metadata; generate signed URLs with short expiry rather than public URLs.

---

## What should never be stored / what's ephemeral

| Data | Where it lives |
|---|---|
| Raw audio stream during the live interview | **Nowhere by default.** Gemini Live processes audio in-session; only the transcribed text is persisted. Storing raw audio for every interview at scale is a massive storage/privacy cost — only enable `voice-recordings/` if a compliance/QA requirement demands it, and auto-delete after a short retention window. |
| Full conversational context Gemini uses to generate the next question | Lives only inside the Gemini Live session for its duration. What you persist afterward is the **summary + transcript**, not the raw context window Gemini assembled from resume + skills + previous answers. |
| Raw analytics events queried for dashboards | BigQuery (via extension), not Firestore, per §12. |
| Full AI prompt/response pairs for every question | Not stored by default (cost); sample only if needed for QA. |
| Resume PII repeated across every interview doc | Store once in `resumes/{id}`; interviews reference it by `resumeVersionUsed` (an ID), not by copying resume text into every interview document. |
| Peer benchmark / percentile numbers | **Generated on demand** via nightly batch job, not computed per-request — see §7. |
| `gamification` / `readiness` scores | Written only by Cloud Functions (server-authoritative), never trusted from client input. |

---

## Duplicate vs. normalize vs. subcollection vs. cache — quick reference

- **Duplicate (denormalize) these:** `userId` on every subcollection doc (security rules + collectionGroup queries); skill scores/readiness on `users/{uid}` (read once per session instead of aggregating on every page); resume `fileName`/`targetRole` inline on `resumes` list view (avoid fetching Storage metadata separately).
- **Normalize (reference by ID) these:** resume ↔ interview link (`resumeVersionUsed`), interview ↔ report link (`reportId`), achievement catalog ↔ user achievements, coding problem ↔ submission.
- **Subcollections:** `conversation` turns, `submissions`, `resumes`, `notifications`, `achievements`, `weeklyStats`, `bookmarks`, `feedback` — all bounded-per-user, queried per-user, no reason to be top-level.
- **Top-level collections:** `interviews` (needs collectionGroup-style cross-user queries for leaderboards/company stats), `codingProblems`, `jobListings`, `achievementsCatalog`, `analyticsEvents` — shared/cross-user data.
- **Client-side cache candidates:** `achievementsCatalog` (24 static docs — fetch once, cache indefinitely with a version field for invalidation), `codingProblems` list (paginate + cache), `users/{uid}` core doc (signal-based cache, refresh only after known mutations).
- **Never updated after creation (immutable):** completed `interviews.results`, `resumes` (new version = new doc), `xpTransactions`-style audit entries if you add one (recommended — see below), `achievements` unlock timestamp.

> **Recommendation:** add an `xpTransactions` audit subcollection (`users/{uid}/xpTransactions/{txId}`) even though it's not in your list — every XP-earning event (interview complete, goal complete, achievement) writes one immutable record here, and `gamification.currentXP` is the running sum. Without this you cannot debug "why does the user have 1240 XP" or handle disputes/exploits.

---

## Composite indexes summary (firestore.indexes.json)

```json
{
  "indexes": [
    { "collectionGroup": "interviews", "fields": [
      { "fieldPath": "userId", "order": "ASCENDING" },
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "completedAt", "order": "DESCENDING" }
    ]},
    { "collectionGroup": "interviews", "fields": [
      { "fieldPath": "userId", "order": "ASCENDING" },
      { "fieldPath": "mode", "order": "ASCENDING" },
      { "fieldPath": "completedAt", "order": "DESCENDING" }
    ]},
    { "collectionGroup": "interviews", "fields": [
      { "fieldPath": "config.company", "order": "ASCENDING" },
      { "fieldPath": "completedAt", "order": "DESCENDING" }
    ]},
    { "collectionGroup": "resumes", "fields": [
      { "fieldPath": "isActive", "order": "ASCENDING" },
      { "fieldPath": "uploadedAt", "order": "DESCENDING" }
    ]},
    { "collectionGroup": "notifications", "fields": [
      { "fieldPath": "read", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" }
    ]},
    { "collectionGroup": "jobMatches", "fields": [
      { "fieldPath": "matchPercent", "order": "DESCENDING" }
    ]},
    { "collectionGroup": "codingProblems", "fields": [
      { "fieldPath": "category", "order": "ASCENDING" },
      { "fieldPath": "difficulty", "order": "ASCENDING" }
    ]}
  ]
}
```

---

## Security rules strategy (summary)

- **Owner-only pattern** for everything under `users/{uid}/...`: `allow read, write: if request.auth.uid == uid`, then explicitly `allow write: if false` on server-computed subfields/subcollections (`gamification`, `readiness`, `achievements`, `weeklyStats`, `careerProgress`).
- **Top-level shared collections** (`codingProblems`, `achievementsCatalog`, `jobListings`): `allow read: if request.auth != null; allow write: if false` (Admin SDK / Cloud Functions only).
- **`interviews`**: owner read/write for `status`, `config`, environment fields during setup; once `status == 'completed'`, lock `results`/`xpEarned` from further client writes (rule checks `resource.data.status != 'completed'` before allowing the update).
- **`analyticsEvents`**: `allow create: if request.auth != null; allow read: if false` — write-only from the client, never read back.
- Use **App Check** in production to block non-app clients from writing directly to Firestore (important since XP/scores are otherwise a spoofing target).

---

## Scalability notes for 1M users / millions of interviews

1. **Never run a query without a `where` clause scoped to the user or a specific indexed field.** Every screen in this app reads scoped data (own user, own resumes, own interviews) — there's no legitimate "scan all interviews" query in the product, which is good; keep it that way.
2. **Aggregate at write time** (`weeklyStats`, `gamification`, `readiness`) instead of read time — this is the difference between O(1) reads per dashboard load and O(n) reads that grow with the user's history.
3. **Peer benchmarking and job matching are the only two features that need cross-user computation** — isolate them into scheduled Cloud Functions writing precomputed results, never synchronous client-triggered aggregation.
4. **Archive old transcript subcollections** to Storage (as compressed JSON) after ~90 days and delete from Firestore — transcripts are read once (report generation) and almost never again, but they're your largest storage line item if kept live indefinitely.
5. **Use Firestore's TTL policies** (native field, e.g. `expireAt`) on `analyticsEvents` and old `notifications` rather than a manual cleanup function.
6. **Batch XP/streak/skill updates in a single transaction** inside `onInterviewComplete` — one interview completion should be 1 transaction touching `users/{uid}`, `weeklyStats/{week}`, and `interviews/{id}`, not 5 separate round-trip writes.
7. **Cache static catalogs client-side** (`codingProblems`, `achievementsCatalog`) with a version/`updatedAt` field — check-and-skip refetch instead of re-reading 24-300 docs every page visit.

---

## Review — gaps to close before implementation

- **Missing:** an `xpTransactions` audit subcollection (added above) — without it XP is unauditable.
- **Missing:** a `deviceCheckLog` isn't strictly needed as its own collection — fold into `interviews.environment`, already done above.
- **Missing field:** `interviews.config` doesn't currently capture *why* the AI ended the interview (`endReason: 'time_expired' | 'user_ended' | 'connection_lost' | 'max_questions_signal'`) — add this; your flow explicitly says duration-based auto-end, so the report/UI needs to distinguish a natural finish from a dropped connection.
- **Missing:** `roadmap` activities reference `linkedInterviewId` but there's no reverse link on `interviews` back to which roadmap activity spawned it — add `interviews.config.sourceRoadmapActivityId?: string` for that traceability (also useful for "recommended for you" attribution/analytics on what drives completion).
- **Open decision needed from you:** do you want a **public leaderboard** (Coding Interviews page shows "#124 Weekly rank")? If yes, that's a `leaderboards/{period}/{uid}` precomputed collection (nightly job) I haven't built out in full — flag if you want that spec added.
- **Open decision needed from you:** resume storage — PDF/DOCX only, or do you also want an **extracted-text** field on `resumes/{id}` for faster re-analysis without re-parsing the file? Recommended: yes, add `analysis.extractedText: string` (or a Storage JSON if long) so re-running ATS scoring doesn't require re-uploading/re-OCRing.

Everything else in your 20-item list is covered above, mapped to the consolidated model in §0.2.