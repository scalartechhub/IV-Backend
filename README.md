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

Local/prod self-hosted Judge0 CE. Full security, cost, and deploy notes: **[judge0/README.md](./judge0/README.md)**.

```bash
# 1. Start Judge0 (loopback only — ₹0 on your machine)
cd judge0 && cp .env.example .env && docker compose up -d
# Wait ~30s, verify:
./scripts/judge0-health.sh          # Windows: .\scripts\judge0-health.ps1

# 2. Start API (JUDGE0_URL=http://127.0.0.1:2358/ in .env)
npm run dev
```

Problems are **AI-generated from the candidate profile** (`POST /v2/coding/generate`), not seeded statically.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v2/coding/languages` | Bearer | Supported languages + Judge0 IDs + templates |
| GET | `/api/v2/coding/questions` | Bearer | List AI problems for the signed-in user |
| GET | `/api/v2/coding/questions/:id` | Bearer | One problem (no hidden tests) |
| POST | `/api/v2/coding/generate` | Bearer | Generate problem from profile + full test suite |
| GET | `/api/v2/coding/submissions/:id` | Bearer | Owner submission metadata (no source body) |
| POST | `/api/v2/coding/run` | Bearer | Run code against public tests or custom input |
| POST | `/api/v2/coding/submit` | Bearer | Submit against public + hidden tests (sanitized I/O) |

Firestore: `users/{uid}/generatedCodingProblems`, `users/{uid}/generatedCodingProblemSecrets`, `users/{uid}/codingProgress`, `users/{uid}/codingSubmissions`, `users/{uid}/codingIdempotency`.

Config: `JUDGE0_URL`, optional `JUDGE0_AUTH_TOKEN` (synced to Firestore `config/judge0`).

**Troubleshooting:** Poll timeout → ensure `workers` is up (`docker compose -f judge0/docker-compose.yml ps`). cgroup errors on official images → keep the cgroup-v2 image in `judge0/docker-compose.yml`.
