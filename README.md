# FraudScope

**FraudScope** is a real-time financial transaction fraud detection platform built for banking and fintech operations teams. It ingests transactions via REST API, evaluates them against five configurable fraud detection rules through a Redis Stream pipeline, scores each transaction from 0 to 100, and surfaces high-risk alerts to analysts through a live dashboard with Socket.io-powered real-time updates. Analysts triage alerts in a priority queue, dismiss false positives, escalate confirmed fraud, and track performance through a full analytics suite — all with a complete audit trail of every decision.

**Live demo:** [fraudscope.vercel.app](https://fraudscope.vercel.app) &nbsp;|&nbsp; **API:** [fraudscope-api.railway.app](https://fraudscope-api.railway.app/health)

Demo credentials: `analyst@fraudscope.dev` / `analyst123`

---

## What it does

```
External system sends transaction
          │
          ▼
  POST /api/v1/transactions
  (REST API, API key auth)
          │
          ▼
  PostgreSQL  ──►  Redis Stream (tx:incoming)
                          │
                          ▼
               ┌─────────────────────┐
               │   Rule Engine       │
               │   Worker Process    │
               │                     │
               │  Velocity Check     │
               │  Amount Anomaly     │
               │  Geo Mismatch       │
               │  Time Anomaly       │
               │  Round Amount       │
               │                     │
               │  Composite score    │
               │  0 – 100            │
               └────────┬────────────┘
                        │
              score ≥ 20 → Alert created
                        │
                        ▼
              Redis Pub/Sub (alerts:new)
                        │
                        ▼
           ┌────────────────────────┐
           │   Socket.io Gateway    │
           │   (WebSocket server)   │
           └────────────┬───────────┘
                        │
                        ▼
           ┌────────────────────────┐
           │   Next.js Dashboard    │
           │                        │
           │   Live Transaction     │
           │   Feed                 │
           │                        │
           │   Alert Queue          │
           │   (triage, dismiss,    │
           │    escalate)           │
           │                        │
           │   Analytics            │
           │   (charts, trends)     │
           │                        │
           │   Admin Console        │
           │   (rules, users,       │
           │    audit logs,         │
           │    system health)      │
           └────────────────────────┘
```

---

## Tech stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 14 App Router, TypeScript, Tailwind CSS, Recharts, Socket.io-client, Leaflet |
| **Backend** | Node.js 20, Express, TypeScript |
| **Database** | PostgreSQL 16 (Knex.js migrations, query-optimized with 17 indexes) |
| **Cache / Queue** | Redis 7 (Streams for async pipeline, Pub/Sub for real-time events, cache for analytics) |
| **Real-time** | Socket.io (JWT-authenticated WebSocket gateway) |
| **Auth** | JWT (15-min access token in memory + 7-day refresh token in httpOnly cookie) |
| **Testing** | Jest + Supertest (30+ integration tests, real PostgreSQL + Redis) |
| **CI/CD** | GitHub Actions (lint + test + build on every PR, deploy on merge to main) |
| **Deployment** | Railway (API + Worker), Vercel (frontend), Docker multi-stage builds |

---

## Fraud detection rules

The rule engine evaluates five configurable patterns in parallel. Each rule contributes a weighted score. The composite score is capped at 100 and mapped to a severity level.

| Rule | What it detects | Score contribution |
|---|---|---|
| **Velocity** | Too many transactions within a rolling time window | 15 – 25 |
| **Amount Anomaly** | Amount significantly above the account's 30-day average | 20 – 30 |
| **Geo Mismatch** | Transaction from an unknown or high-risk country | 20 – 25 |
| **Time Anomaly** | Transaction during configurable suspicious hours | 15 |
| **Round Amount** | Suspiciously round amounts above a threshold | 15 – 25 |

| Score | Severity | Action |
|---|---|---|
| 0 – 19 | — | No alert created |
| 20 – 39 | Low | Alert created |
| 40 – 59 | Medium | Alert created |
| 60 – 79 | High | Alert created |
| 80 – 100 | **Critical** | Alert created, immediate review required |

Rules are fully configurable via the admin dashboard — create, edit, toggle, and tune parameters without redeploying.

---

## Local setup

**Prerequisites:** Docker Desktop, Node.js 20+, Git

```bash
# 1. Clone the repository
git clone https://github.com/Krish-Barot/fraudscope.git
cd fraudscope

# 2. Configure environment
cp .env.example .env
# The defaults in .env.example work for local development

# 3. Start all services (PostgreSQL, Redis, API, Worker, Next.js)
docker compose up --build -d

# 4. Run database migrations
docker compose exec api sh -c "cd apps/api && npm run migrate"

# 5. Seed initial data (2 users, 5 detection rules, 1000 transactions)
docker compose exec api sh -c "cd apps/api && npm run seed"
```

Open [http://localhost:3000](http://localhost:3000).

| Credential | Email | Password |
|---|---|---|
| Analyst | analyst@fraudscope.dev | analyst123 |
| Admin | admin@fraudscope.dev | admin123 |

---

## Running tests

Tests run against a real PostgreSQL and Redis instance (no mocks). The test database is separate from the development database.

```bash
# Run the full test suite
docker compose exec api sh -c "cd apps/api && npm test"

# Run a single test file
docker compose exec api sh -c "cd apps/api && npm test -- tests/alerts.test.ts"

# Run with coverage report
docker compose exec api sh -c "cd apps/api && npm test -- --coverage"
```

**Test coverage:**

| Area | Tests | What is verified |
|---|---|---|
| Auth | 15 | Register, login, refresh, token expiry, protected routes |
| Transactions | 13 | Ingest, list, filter, pagination, duplicate prevention |
| Alerts | 15 | List, counts, full detail with rules and history |
| Alert actions | 20 | State machine transitions, reason validation, audit trail |
| Rules API | 22+ | CRUD, parameter validation per rule type, toggle, delete guard |
| Rule engine | 140+ | All 5 rule modules, composite scoring, severity thresholds |

---

## Transaction simulator

The built-in simulator generates realistic transactions with configurable fraud ratios, letting you populate the dashboard without external integrations.

```bash
# Generate transactions at 3/sec with 20% fraud
cd apps/api
SIM_ENABLED=true SIM_RATE=3 SIM_FRAUD_RATIO=0.2 npm run simulate
```

Open the dashboard and watch the Live Feed populate in real time. Flagged transactions appear with colored severity borders. Alerts surface in the Alert Queue automatically.

```bash
# High-volume stress test
SIM_ENABLED=true SIM_RATE=10 SIM_FRAUD_RATIO=0.5 npm run simulate
```

---

## API

Full API reference: [docs/api.md](docs/api.md)

Quick start:

```bash
# Get an access token
TOKEN=$(curl -s -X POST http://localhost:3002/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"analyst@fraudscope.dev","password":"analyst123"}' \
  | jq -r '.access_token')

# Send a transaction
curl -X POST http://localhost:3002/api/v1/transactions \
  -H "x-api-key: dev_api_key_fraudscope" \
  -H "Content-Type: application/json" \
  -d '{
    "external_id": "TX-TEST-001",
    "account_id": "ACC-DEMO",
    "amount": 9999.00,
    "currency": "CAD",
    "country_code": "NG",
    "merchant_name": "CRYPTO-EXCHANGE"
  }'

# Check the alert queue
curl "http://localhost:3002/api/v1/alerts?status=new&sort=risk_score:desc" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[0] | {risk_score, severity, status}'
```

---

## Performance

All major database queries are under 10ms on the seed dataset (target was 100ms). See [docs/query-optimization.md](docs/query-optimization.md) for full EXPLAIN ANALYZE results.

Key optimizations applied:

```sql
-- Alert queue (largest query, runs on every dashboard load)
-- Before: Seq Scan + in-memory sort, 28ms
-- After: Index Scan already sorted by risk_score, 2.8ms
CREATE INDEX idx_alerts_status_score ON alerts(status, risk_score DESC);

-- Audit log date filter (grows unboundedly — most critical index)
-- Before: full table Seq Scan, 55ms
-- After: Index Scan with early stop after 50 rows, 4.2ms
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- Analytics are cached in Redis (5-min TTL, configurable)
-- Cache hit: <1ms vs PostgreSQL: 15-55ms
```

---

## Project structure

```
fraudscope/
├── apps/
│   ├── api/                        Node.js/Express backend
│   │   ├── src/
│   │   │   ├── engine/             Rule engine + Redis Stream worker
│   │   │   │   ├── rules/          5 fraud detection rule modules
│   │   │   │   ├── scorer.ts       Parallel rule evaluation + scoring
│   │   │   │   └── worker.ts       XREADGROUP consumer with XAUTOCLAIM
│   │   │   ├── modules/            REST API modules (auth, transactions,
│   │   │   │                       alerts, rules, analytics, audit, health)
│   │   │   ├── middleware/         JWT auth, RBAC, error handling
│   │   │   ├── websocket/          Socket.io gateway (Redis Pub/Sub bridge)
│   │   │   └── utils/              Analytics caching utility
│   │   ├── migrations/             8 Knex migrations
│   │   └── tests/                  Jest integration tests (30+ tests)
│   └── web/                        Next.js 14 App Router frontend
│       └── app/dashboard/
│           ├── page.tsx            Live transaction feed
│           ├── alerts/             Alert triage queue
│           ├── transactions/[id]/  Transaction investigation detail
│           ├── analytics/          Charts and performance metrics
│           └── admin/              Rules, users, audit logs, system health
├── docs/
│   ├── api.md                      Full API reference
│   ├── query-optimization.md       EXPLAIN ANALYZE results
│   └── ci-setup.md                 CI/CD secrets configuration
├── .github/workflows/ci.yml        GitHub Actions pipeline
├── docker-compose.yml              Development stack
├── docker-compose.prod.yml         Production stack
└── .env.example                    All environment variables documented
```

---

## CI/CD pipeline

```
Push or PR to main
       │
       ▼
   test job
   ├── npm ci (api + web)
   ├── ESLint (api + web)
   ├── Start PostgreSQL 16 + Redis 7 (services block)
   ├── Run Knex migrations
   ├── Jest --runInBand --coverage
   └── Next.js production build
       │
       │  merge to main only
       ▼
   deploy job
   ├── Railway CLI → API service + Worker service
   └── Vercel CLI → Next.js frontend (--prod)
```

---

## Deployment

**Railway (API + Worker):** Each service is deployed from the same multi-stage Dockerfile. The API runs `node dist/index.js`. The Worker overrides the command to run `node dist/engine/worker.js`. A pre-deploy hook runs `knex migrate:latest` automatically on every deploy.

**Vercel (Frontend):** Next.js standalone output mode produces a self-contained `server.js` (~100MB image vs ~600MB full). Deployed automatically on merge to main via GitHub Actions.

**Docker Compose (self-hosted):**
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Full deployment guide: [README.md#deployment](README.md#deployment) in the repository.

---

## Resume bullets

This project demonstrates the following production engineering skills:

- **Built a real-time fraud detection pipeline** processing transactions through a Redis Streams queue into a parallel rule engine (5 detection patterns), computing composite 0-100 risk scores and broadcasting alerts via Socket.io to a Next.js analyst dashboard
- **Designed and implemented a full-stack SaaS product** with JWT authentication (access + refresh token pattern), role-based access control across analyst and admin tiers, and a complete audit trail on every state-changing operation
- **Wrote 30+ integration tests** (Jest + Supertest) covering auth flows, rule evaluation, alert state machine transitions, and API pagination — running against real PostgreSQL and Redis in a CI services block
- **Optimized PostgreSQL query performance** by 5x-42x across 12 major queries using EXPLAIN ANALYZE-guided composite indexes, and added Redis analytics caching (300s TTL) reducing repeated dashboard loads from 55ms to under 1ms
- **Deployed a containerized monorepo** using multi-stage Docker builds (API ~80MB, web ~100MB), GitHub Actions CI/CD pipeline (lint + test + build on every PR, Railway + Vercel deploy on merge to main), and production Docker Compose with health checks, restart policies, and resource limits

---