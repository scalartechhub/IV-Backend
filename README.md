# IV-Backend

AI Interview Platform backend — Node.js, Express, TypeScript, Firebase, Gemini.

## Setup

1. Copy `.env.example` to `.env` and configure values.
2. Place secrets only in `.env` or your secret manager — **never in source code**.
3. Install and run:

```bash
npm install
npm run dev
```

## Authentication (email / password)

Email and password only. **Register does not return a token** — call Login after registering.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Create account `{ name, email, password }` |
| POST | `/api/auth/login` | No | Returns `{ idToken, ...user }` — use `idToken` as Bearer token |
| GET | `/api/auth/me` | Bearer | Current user + interview stats |
| POST | `/api/auth/logout` | Bearer | Revoke refresh tokens |

**Bruno flow:** Register → Login (auto-saves `token`) → interview requests.

## Firestore architecture (2 collections)

All interview data is embedded in a single document for minimal reads/writes.

| Collection | Document ID | Purpose |
|------------|-------------|---------|
| `users/{uid}` | Firebase Auth UID | Profile + aggregate stats |
| `interviews/{interviewId}` | Auto-generated | Full interview lifecycle |

### Interview document (single read for detail page)

`GET /api/interviews/:id` returns questions, answers, scores, feedback, and report in **one Firestore read**.

Embedded fields:

- `questions[]` — id, question, difficulty, answer?, score?, feedback?, answeredAt?
- `report?` — overallScore, strengths, weaknesses, recommendations, summary, generatedAt

### User stats (`UserStatsService`)

Updated automatically:

- `totalInterviews` — incremented on interview create
- `completedInterviews`, `averageScore`, `bestScore` — updated on interview finish

## Secrets management

All sensitive values are loaded once at startup via `SecretService`.

**Required at startup:** `GEMINI_API_KEY`, `FIREBASE_API_KEY`, Firebase Admin credentials.

## Firestore indexes

Deploy updated indexes (includes `isDeleted` composite queries):

```bash
firebase deploy --only firestore:indexes
```

## API testing (Bruno)

Open `bruno/AI Interview Backend` in Bruno. Use the **local** environment.

### Breaking API changes

| Before | After |
|--------|-------|
| `role` | `technology` |
| `experience` | `experienceLevel` |
| `type: behavioral` | `interviewType: hr` |
| `status: in_progress` | `status: started` |
| `overallPerformance` | `overallScore` |
| `totalQuestions` | `questionCount` |
| Separate `/questions`, `/report` reads | Prefer `GET /interviews/:id` (single read) |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled server |

## Coding platform (Judge0)

Local code execution uses Judge0 in Docker. Your host is likely **cgroup v2** (Ubuntu 22+/modern Linux); the compose file uses a cgroup-v2-compatible image plus **workers** (required — API alone only queues jobs).

```bash
# 1. Start Judge0 (from repo root)
cd judge0 && docker compose down --remove-orphans && docker compose up -d
# Wait ~25s, verify:
curl -s -X POST 'http://localhost:2358/submissions?base64_encoded=false&wait=true' \
  -H 'Content-Type: application/json' \
  -d '{"source_code":"print(42)","language_id":71}'
# Expect status.description = "Accepted"

# 2. Seed Firestore problems (requires firebase-service-account.json)
npm run seed:coding

# 3. Start API (set JUDGE0_URL=http://localhost:2358 in .env)
npm run dev
```

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/coding/run` | Bearer | Run code against public tests or custom input |
| POST | `/api/coding/submit` | Bearer | Submit against public + hidden tests |

Firestore collections: `codingProblems`, `codingProblemSecrets`, `users/{uid}/codingProgress`, `users/{uid}/codingSubmissions`.

**Troubleshooting:** If Run fails with poll timeout, ensure `workers` is up (`docker compose ps`). If you see `/sys/fs/cgroup/memory` errors on official `judge0/judge0`, stay on the cgroup-v2 image in `judge0/docker-compose.yml` (or boot the host with cgroup v1).
