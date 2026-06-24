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
