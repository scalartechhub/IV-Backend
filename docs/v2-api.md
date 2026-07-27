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
| POST | `/v2/interviews/start` | Full config **or** `{ templateId }` / `{ companyId }` / `{ quickStart: true }` | Create interview `status: created`, return `interviewId` + `geminiSessionConfig` |
| POST | `/v2/interviews/:id/complete` | `{ transcriptSummary, durationSec, endReason }` | Score, XP, skills, streak, weeklyStats (+ `sessionsByDay`), goals, report |
| PATCH | `/v2/interviews/:id/status` | `{ status }` | Advance UI flow: `device_check` / `in_progress` / `abandoned` / `expired` |
| PATCH | `/v2/interviews/:id/environment` | device fields | Save setup device-check; may move status to `device_check` |
| GET | `/v2/interviews` | `?status=&mode=&limit=` | List owner interviews |
| GET | `/v2/interviews/:id` | — | Get one interview (owner only) |
| GET | `/v2/interviews/:id/live-token` | — | Mint a short-lived Gemini Live ephemeral token so the browser can connect directly to Gemini's Live API (see below) |
| GET | `/v2/practice/catalog` | `?q=&categoryId=` | Categories + companies + recommended sessions |
| GET | `/v2/reports/summary` | — | Metrics, skill trends, radar, heatmap for `/reports` |
| GET | `/v2/reports` | `?limit=` | List per-interview reports |
| GET | `/v2/reports/:id` | — | Single report detail |
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

### Example: start interview (full config)

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

### Example: start from Practice UI

```http
POST /api/v2/interviews/start
{ "templateId": "rxjs-state" }

POST /api/v2/interviews/start
{ "companyId": "google" }

POST /api/v2/interviews/start
{ "quickStart": true }
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

### Live interview session (client-side Gemini Live)

The v2 architecture runs the actual audio session **directly from the browser** against Gemini's
Live API — the backend never proxies audio. Flow:

1. `POST /v2/interviews/start` → `{ interviewId }`.
2. After device check / guidelines, call `GET /v2/interviews/{id}/live-token` → `{ token, model, expireTime }`.
3. In the browser: `new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } })`, then
   `ai.live.connect({ model, config: { responseModalities: ['AUDIO'] }, callbacks })`.
4. Stream mic audio (16kHz PCM16) via `session.sendRealtimeInput({ audio: { data, mimeType: 'audio/pcm;rate=16000' } })`
   and play back model audio (24kHz PCM16) from `serverContent.modelTurn.parts[].inlineData`.
5. On end, call `POST /v2/interviews/{id}/complete` with a transcript summary built from the
   session's input/output transcriptions.

Tokens are single-use and expire in 30 minutes (new sessions must start within 5 minutes of minting),
so request a fresh token right before connecting.

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
