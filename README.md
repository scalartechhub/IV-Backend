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

## Secrets management

All sensitive values are loaded once at startup via `SecretService` and cached in memory.

| Secret | Access |
|--------|--------|
| `GEMINI_API_KEY` | `secretService.getGeminiApiKey()` |
| `FIREBASE_API_KEY` | `secretService.getFirebaseApiKey()` |
| Firebase Admin creds | `secretService.getFirebaseCredentials()` |
| `JWT_SECRET` (optional) | `secretService.getJwtSecret()` |
| `SMTP_PASSWORD` (optional) | `secretService.getSmtpPassword()` |

**Required at startup:** `GEMINI_API_KEY`, `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

**Local dev fallback:** `firebase-service-account.json` or `GOOGLE_APPLICATION_CREDENTIALS` if inline Firebase env vars are not set.

**Architecture:**

```text
src/config/secrets/
├── secret.service.ts      # Cached, typed access
├── secret.validation.ts   # Fail-fast startup checks
├── secret.types.ts
└── providers/
    ├── env-secret.provider.ts           # Current (env vars)
    └── gcp-secret-manager.provider.ts   # Stub for cloud migration
```

Non-secret config lives in `src/config/app.config.ts` (port, CORS, Gemini model, etc.).

Logs automatically mask API keys, tokens, and registered secrets.

## Firestore indexes

```bash
firebase deploy --only firestore:indexes
```

## Migrate legacy reports

```bash
npm run migrate:reports
npm run migrate:reports -- --apply
```

## API testing (Bruno)

Open `bruno/AI Interview Backend` in Bruno. Use the **local** environment.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled server |
| `npm run migrate:reports` | Dry-run report ID migration |
