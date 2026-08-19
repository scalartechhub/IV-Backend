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
| GET | `/v2/practice/catalog` | `?q=&categoryId=` | Categories + companies + recommended sessions |
| GET | `/v2/reports/summary` | — | Metrics, skill trends, radar, heatmap for `/reports` |
| GET | `/v2/reports` | `?limit=` | List per-interview reports |
| GET | `/v2/reports/:id` | — | Single report detail |
| POST | `/v2/resumes/analyze` | multipart `file` (+ optional `targetRole`) | Upload PDF → Storage + Gemini ATS → activate resume |
| POST | `/v2/resumes/upload` | `{ storagePath, fileName, targetRole, resumeId? }` | Analyze a PDF already in Storage → activate |
| GET | `/v2/resumes` | — | List resumes |
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

### Live interview session (server-side WebSocket bridge)

The v2 architecture proxies the live audio session through a backend WebSocket bridge — the same
technique the legacy `/interviews/*` flow uses — so `GEMINI_API_KEY` never reaches the browser.
This bridge runs on a dedicated **Google Cloud Run** service (`interview-websocket` on `wss://<cloud-run-url>/ws/v2/interview` or custom domain `wss://ws.interviewup.ai/ws/v2/interview`). It runs as a long-lived Node server process because Firebase Cloud Functions HTTP triggers cannot maintain persistent WebSocket upgrade handshakes (HTTP 101).


**Turn-taking:** Gemini automatic VAD is disabled. The browser marks answer boundaries with
`activityStart` / `activityEnd` (typically when the candidate taps **Done answering**), so long
answers with thinking pauses are not cut off. **Candidate captions** in the UI come from the
browser Web Speech API (`en-US`); the bridge only forwards **AI** transcripts/audio.

Flow:

1. `POST /v2/interviews/start` → `{ interviewId }`.
2. After device check / guidelines, open a WebSocket:
   `wss://<host>/ws/v2/interview?interviewId=<id>&token=<Firebase ID token>`.
3. The server verifies the token + interview ownership/status, connects to Gemini Live itself
   (`ai.live.connect`) using the interview's cached `aiSession.systemInstructions`, and relays
   messages using this protocol:

   | Direction | `type` | Payload |
   |-----------|--------|---------|
   | Client → Server | `audio` | `{ data, mimeType? }` — mic audio, 16kHz PCM16 base64 |
   | Client → Server | `activityStart` | Marks the start of the candidate's answer turn |
   | Client → Server | `activityEnd` | Marks the end of the answer — Gemini may speak next |
   | Client → Server | `end` | Ends the call and closes the Gemini session |
   | Server → Client | `open` | Gemini session is ready; mic streaming triggers kickoff |
   | Server → Client | `transcript` | `{ role: 'ai', text, final }` — interviewer captions only |
   | Server → Client | `audio` | `{ data, mimeType }` — model audio, 24kHz PCM16 base64 |
   | Server → Client | `turnComplete` | Interviewer finished a turn; candidate may answer |
   | Server → Client | `interrupted` | Model generation was interrupted |
   | Server → Client | `error` | `{ message }` |
   | Server → Client | `close` | `{ reason? }` — session ended |

4. On end, call `POST /v2/interviews/{id}/complete` with a transcript summary built from the
   conversation log (browser STT for the candidate + AI `transcript` events).

The server pins `speechConfig`/transcription `languageHints` to English (`en-US`, `en-IN`), and
kicks off the interviewer's first question via `sendRealtimeInput({ text })` once mic audio is
flowing — the candidate never has to speak first.

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
