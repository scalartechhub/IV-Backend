# Judge0 deployment (Phase C)

Self-hosted **Judge0 Community Edition** for InterviewUp coding run/submit. The Angular app never talks to Judge0; only `IV-Backend` does.

## Cost reality

| Environment | Setup | Extra recurring ₹ |
|---|---|---|
| **Dev** | Docker Compose on your laptop (`127.0.0.1:2358`) | **₹0** |
| **Prod** | Same Compose on a VM/host you **already** pay for, spare CPU/RAM | **₹0 extra** |
| **Prod** | New always-on cloud VM only for Judge0 | **Not free** |

Judge0 CE software is free. Hosting is free only when you reuse spare capacity. Do not assume public free compiler APIs are allowed for commercial prod.

**Recommended host size (shared/spare):** 2 vCPU, 4–8 GB RAM, 20+ GB disk. This compose caps workers/server (~1 CPU / 1.5 GB each) plus Postgres/Redis.

## Security model (do not weaken)

1. **Privileged containers stay on** — isolate needs `privileged`, `cgroup: host`, and rw `/sys/fs/cgroup`. Removing these breaks execution or forces weaker sandboxes.
2. **API bind is loopback/private only** — default `JUDGE0_BIND_HOST=127.0.0.1`. Never publish `0.0.0.0:2358` on the public internet.
3. **Postgres/Redis have no host ports** — reachable only on the Docker bridge.
4. **Optional `AUTH_TOKEN`** — enable for any non-laptop host; backend sends `X-Auth-Token`.
5. **No Firebase credentials on the Judge0 host** — keep service accounts and `.env` API secrets off this machine when possible. Prefer API co-located calling `http://127.0.0.1:2358`.
6. **Callbacks disabled** — `ENABLE_CALLBACKS=false` so Judge0 does not dial out with results.

## Local (dev) — ₹0

```bash
cd judge0
cp .env.example .env
# optional: set a stronger POSTGRES_PASSWORD
docker compose down --remove-orphans
docker compose up -d
# wait ~30s
cd ..
./scripts/judge0-health.sh
# Windows: .\scripts\judge0-health.ps1
```

In repo root `.env` (API):

```env
JUDGE0_URL=http://127.0.0.1:2358/
JUDGE0_AUTH_TOKEN=
```

Then `npm run dev`.

## Production on existing spare capacity

### A. Preferred (₹0 extra, private)

Run Judge0 on the **same host** that already runs a long-lived Node process that can call loopback (or a private VPC IP). Point Firestore `config/judge0` at that private URL.

```env
# judge0/.env on the VM
JUDGE0_BIND_HOST=127.0.0.1
JUDGE0_ENABLE_AUTHENTICATION=true
JUDGE0_AUTH_TOKEN=<long-random-secret>
POSTGRES_PASSWORD=<long-random-secret>
JUDGE0_NUMBER_OF_WORKERS=2
JUDGE0_MAX_MEMORY_LIMIT=256000
JUDGE0_MAX_CPU_TIME_LIMIT=10
```

```bash
cd judge0 && docker compose up -d
```

Firestore / API env for the process that handles `/v2/coding/*`:

```env
JUDGE0_URL=http://127.0.0.1:2358/
JUDGE0_AUTH_TOKEN=<same-as-above>
```

Sync to Firestore when you use `sync:firebase-config`:

```bash
npm run sync:firebase-config:prod
```

Documents written: `config/judge0` → `{ url, authToken }`.

### B. Cloud Functions calling a remote Judge0

Cloud Functions **cannot** use `localhost` on your laptop or a VM without a network path.

Options:

1. **Co-locate** coding traffic with a host that shares the Judge0 private network (recommended for ₹0 extra).
2. **Serverless VPC Access** to a private IP — works, but the connector may add cost (verify before claiming ₹0).
3. **Temporary:** private firewall + auth token to a non-public NIC only. Do **not** leave `2358` open to `0.0.0.0/0`.

The old public default `http://34.180.31.202:2358/` is removed from code fallbacks. If that VM is yours, re-bind to `127.0.0.1` or a VPC IP, rotate Postgres password, enable auth, and update `config/judge0`.

## Firewall checklist (manual — not applied by this repo)

- [ ] Port `2358` not open to `0.0.0.0/0`
- [ ] Postgres `5432` / Redis `6379` not published on the host
- [ ] Only backend CIDRs / private VPC can reach Judge0 (if not loopback-only)
- [ ] `JUDGE0_ENABLE_AUTHENTICATION=true` + strong `AUTH_TOKEN` on shared hosts
- [ ] Host has no Firebase Admin JSON / Gemini keys unless unavoidable
- [ ] Disk monitoring — isolate work dirs can grow under load

## Environment variables

### API (`IV-Backend` / Firestore `config/judge0`)

| Variable | Purpose |
|---|---|
| `JUDGE0_URL` | Base URL, e.g. `http://127.0.0.1:2358/` |
| `JUDGE0_AUTH_TOKEN` | Optional; sent as `X-Auth-Token` |

### Compose (`judge0/.env`)

See `.env.example` for bind host, Postgres, auth, worker count, CPU/memory caps.

## Health / rollback

```bash
docker compose -f judge0/docker-compose.yml ps
./scripts/judge0-health.sh http://127.0.0.1:2358
```

Rollback:

```bash
cd judge0
docker compose down
# restore previous compose / .env from backup, then:
docker compose up -d
```

Data volume `judge0-db-data` persists submissions metadata inside Judge0; deleting the volume is destructive — do not remove unless intentional.

## What this repo does not do automatically

- Create or resize a GCP/AWS VM
- Change cloud firewall rules
- Verify billing / spare capacity
- Deploy Judge0 for you

Those steps stay manual on your existing host so nothing destructive runs without your approval.
