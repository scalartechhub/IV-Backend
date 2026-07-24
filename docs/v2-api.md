# V2 API Reference

Architecture-aligned REST endpoints for AllInterviewPro. Legacy `/interviews/*`, `/auth/*`, `/payment/*`, `/ats/*`, `/chat*` remain unchanged.

## Base URL

| Environment | Base |
|-------------|------|
| Local (`npm run dev`) | `http://localhost:<PORT>/api` |
| Cloud Functions (`api`) | `https://<region>-<project>.cloudfunctions.net/api` |

All v2 routes are under `/v2` and require auth.

## Auth

```
Authorization: Bearer <Firebase ID token>
```

Same middleware as legacy routes (`verifyToken`).

## Endpoints

| Method | Path | Body / Query | Description |
|--------|------|--------------|-------------|
| POST | `/v2/interviews/start` | `InterviewConfig` (+ optional `mode`) | Create interview `status: created`, return `interviewId` + `geminiSessionConfig` |
| POST | `/v2/interviews/:id/complete` | `{ transcriptSummary, durationSec, endReason }` | Score, XP, skills, streak, weeklyStats, goals; return results payload |
| GET | `/v2/interviews` | `?status=&mode=&limit=` | List owner interviews |
| GET | `/v2/interviews/:id` | — | Get one interview (owner only) |
| POST | `/v2/resumes/analyze` | multipart `file` (+ optional `targetRole`) | Upload PDF → Storage + Gemini ATS → activate resume |
| POST | `/v2/resumes/upload` | `{ storagePath, fileName, targetRole, resumeId? }` | Analyze a PDF already in Storage → activate |
| GET | `/v2/resumes` | — | List resumes |
| GET | `/v2/resumes/active` | — | Active resume |
| POST | `/v2/coding/submit` | `{ interviewId, problemId, code, language }` | Sandboxed tests via `CODE_RUNNER_URL` |
| POST | `/v2/roadmap/regenerate` | `{ targetRole? }` | New active roadmap; archive previous |
| GET | `/v2/roadmap/active` | — | Active roadmap |
| GET | `/v2/profile` | — | `users/{uid}` (lazy-inits `stats` + skills) |
| PATCH | `/v2/profile/settings` | `{ profile?, preferences?, displayName? }` | Settings updates (not gamification/readiness) |
| GET | `/v2/achievements` | — | Catalog + unlocked |
| POST | `/v2/achievements/check` | `{ overallScore? }` | Evaluate rules; `score_gte` needs `overallScore` |

### Example: start interview

```http
POST /api/v2/interviews/start
Authorization: Bearer <token>
Content-Type: application/json

{
  "skills": ["Angular", "RxJS"],
  "technologies": ["TypeScript"],
  "difficulty": "medium",
  "durationMinutes": 45,
  "currentRole": "Angular Developer",
  "targetRole": "Senior Angular Engineer",
  "mode": "conversational"
}
```

### Example: complete interview

```http
POST /api/v2/interviews/{interviewId}/complete
Authorization: Bearer <token>
Content-Type: application/json

{
  "transcriptSummary": "Candidate discussed signals and change detection...",
  "durationSec": 2400,
  "endReason": "user_ended"
}
```

`endReason`: `time_expired` | `user_ended` | `connection_lost` | `max_questions_signal`

### Response envelope

```json
{ "success": true, "message": "...", "data": { } }
```

## Firebase callables (same services)

| Callable | Service |
|----------|---------|
| `startInterview` | `interview.service.startInterview` |
| `completeInterview` | `interview.service.completeInterview` |
| `uploadResume` | `resume.service.uploadResume` |
| `submitCodingSolution` | `coding.service.submitCodingSolution` |
| `regenerateRoadmap` | `roadmap.service.regenerateRoadmap` |
| `saveProfileSettings` | `profile.service.saveProfileSettings` |

## Env notes

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Scoring, resume ATS, roadmap |
| `CODE_RUNNER_URL` | Cloud Run sandbox for coding submissions (stub returns 0 passed if unset) |
| `GEMINI_LIVE_MODEL` | Model name stamped on interview `aiSession` / session config |

## Legacy vs v2

- **Legacy** `/interviews/*` — existing Express interview module (unchanged).
- **V2** `/v2/*` — writes architecture `InterviewDoc` / resume / XP pipeline shapes from `docs/firebase-architecture.md`.

Migrate clients to `/v2` when ready; both can run in parallel.
