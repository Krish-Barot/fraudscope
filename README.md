# FraudScope

Real-time financial transaction fraud detection dashboard built for banking and fintech teams.

## Architecture

```
┌─────────────────┐     POST /tx      ┌──────────────────┐
│   Transaction   │ ─────────────────► │   API Server     │
│   Source/Sim    │                    │   (Express)      │
└─────────────────┘                    └────────┬─────────┘
                                                │
                                    ┌───────────┼───────────┐
                                    ▼           ▼           ▼
                             PostgreSQL     Redis        Socket.io
                             (storage)   (Streams +    (real-time
                                          Pub/Sub)      events)
                                                │
                                       ┌────────┴────────┐
                                       │  Rule Engine    │
                                       │    Worker       │
                                       │ (5 fraud rules) │
                                       └─────────────────┘
                                                │
                                    Alert generated (score ≥ 20)
                                                │
                                       ┌────────▼────────┐
                                       │ Next.js Frontend│
                                       │  Live Feed      │
                                       │  Alert Queue    │
                                       │  Analytics      │
                                       └─────────────────┘
```

**Stack:**
- **Backend:** Node.js 20, Express, TypeScript, Knex.js
- **Frontend:** Next.js 14 App Router, Tailwind CSS, Recharts
- **Database:** PostgreSQL 16
- **Cache/Queue:** Redis 7 (Streams + Pub/Sub)
- **Real-time:** Socket.io
- **Containerization:** Docker, Docker Compose
- **CI/CD:** GitHub Actions, Railway (API), Vercel (Web)

---

## Local Development

### Prerequisites

- Docker Desktop
- Node.js 20+
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/your-username/fraudscope.git
cd fraudscope

# Copy environment variables
cp .env.example .env
# Edit .env with your values

# Start all services
docker compose up --build -d

# Run database migrations
docker compose exec api sh -c "cd apps/api && npm run migrate"

# Seed initial data (2 users, 5 rules, 1000 transactions)
docker compose exec api sh -c "cd apps/api && npm run seed"
```

### Default credentials

| Role | Email | Password |
|---|---|---|
| Analyst | analyst@fraudscope.dev | analyst123 |
| Admin | admin@fraudscope.dev | admin123 |

### Access

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:3002 |
| API Health | http://localhost:3002/health |

### Run the transaction simulator

```bash
# Generate test transactions at 3/sec with 20% fraud ratio
cd apps/api
SIM_ENABLED=true SIM_RATE=3 SIM_FRAUD_RATIO=0.2 npm run simulate
```

### Run tests

```bash
docker compose exec api sh -c "cd apps/api && npm test"
```

---

## Project Structure

```
fraudscope/
├── apps/
│   ├── api/                        Backend
│   │   ├── src/
│   │   │   ├── config/             Env validation, database, Redis
│   │   │   ├── engine/             Rule engine + worker
│   │   │   │   ├── rules/          5 detection rules
│   │   │   │   ├── scorer.ts       Composite scoring
│   │   │   │   └── worker.ts       Redis Stream consumer
│   │   │   ├── middleware/         Auth, authorize, errors
│   │   │   ├── modules/            REST API modules
│   │   │   │   ├── auth/
│   │   │   │   ├── transactions/
│   │   │   │   ├── alerts/
│   │   │   │   ├── rules/
│   │   │   │   ├── analytics/
│   │   │   │   ├── audit/
│   │   │   │   └── health/
│   │   │   ├── websocket/          Socket.io gateway
│   │   │   └── index.ts            Entry point
│   │   ├── migrations/             Knex migrations
│   │   ├── seeds/                  Seed data
│   │   └── tests/                  Jest integration tests
│   └── web/                        Frontend
│       └── app/
│           └── dashboard/
│               ├── page.tsx        Live feed
│               ├── alerts/         Alert queue
│               ├── transactions/   Transaction detail
│               ├── analytics/      Charts
│               └── admin/          Rules, Users, Audit, System
├── docs/
│   ├── query-optimization.md       EXPLAIN ANALYZE results
│   └── ci-setup.md                 CI/CD configuration
├── .github/workflows/ci.yml        GitHub Actions
├── docker-compose.yml              Development
└── docker-compose.prod.yml         Production
```

---

## Fraud Detection Rules

| Rule | Trigger | Score |
|---|---|---|
| **Velocity** | Too many transactions in a short window | 15-25 |
| **Amount Anomaly** | Amount significantly above 30-day average | 20-30 |
| **Geo Mismatch** | Transaction from new or high-risk country | 20-25 |
| **Time Anomaly** | Transaction during suspicious hours (2-5 AM) | 15 |
| **Round Amount** | Suspiciously round amount above threshold | 15-25 |

**Risk scoring:** Rules run in parallel. Composite score = sum of contributions, capped at 100.

| Score | Severity | Action |
|---|---|---|
| 0-19 | Clean | No alert |
| 20-39 | Low | Alert created |
| 40-59 | Medium | Alert created |
| 60-79 | High | Alert created |
| 80-100 | Critical | Alert created, urgent review |

---

## API Reference

### Authentication

```bash
# Login
POST /api/v1/auth/login
{ "email": "analyst@fraudscope.dev", "password": "analyst123" }

# Refresh token (uses httpOnly cookie automatically)
POST /api/v1/auth/refresh
```

### Transactions

```bash
# Ingest transaction (API key auth)
POST /api/v1/transactions
x-api-key: your-api-key
{ "external_id": "TX-001", "account_id": "ACC-001", "amount": 150.00, ... }

# List transactions (JWT auth)
GET /api/v1/transactions?status=flagged&limit=25&page=1

# Transaction detail with alerts and account history
GET /api/v1/transactions/:id
```

### Alerts

```bash
# Alert queue
GET /api/v1/alerts?status=new,reviewing&sort=risk_score:desc

# Alert counts (sidebar badge)
GET /api/v1/alerts/counts

# Take action on alert
POST /api/v1/alerts/:id/actions
{ "action": "dismiss|escalate|investigate", "reason": "..." }
```

### Analytics

```bash
GET /api/v1/analytics/overview?from=2026-01-01&to=2026-01-31
GET /api/v1/analytics/alert-volume?from=...&to=...
GET /api/v1/analytics/severity?from=...&to=...
GET /api/v1/analytics/rule-effectiveness?from=...&to=...
GET /api/v1/analytics/resolution?from=...&to=...
GET /api/v1/analytics/analyst-performance?from=...&to=...

# Bust analytics cache (admin only)
POST /api/v1/analytics/cache/bust
```

---

## Deployment

### Railway (API + Worker)

Railway hosts the API server and rule engine worker as separate services
connected to managed PostgreSQL and Redis plugins.

#### 1. Create Railway project

```bash
npm install -g @railway/cli
railway login
railway init
```

#### 2. Provision plugins

In the Railway dashboard for your project:
- Click **New** > **Database** > **PostgreSQL** -- note the `DATABASE_URL`
- Click **New** > **Database** > **Redis** -- note the `REDIS_URL`

#### 3. Create API service

```bash
# From the repo root
railway up --service api
```

Set environment variables in Railway dashboard under the API service:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3002` |
| `DATABASE_URL` | From PostgreSQL plugin (auto-linked) |
| `REDIS_URL` | From Redis plugin (auto-linked) |
| `JWT_ACCESS_SECRET` | Generate: `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | Generate: `openssl rand -hex 32` |
| `API_KEY` | Generate: `openssl rand -hex 16` |
| `CORS_ORIGIN` | Your Vercel frontend URL |
| `LOG_LEVEL` | `info` |
| `ANALYTICS_CACHE_TTL` | `300` |

#### 4. Run migrations as a deploy hook

In Railway, under the API service settings:

**Deploy Command:**
```
node -r ./node_modules/tsx/dist/cjs/index.cjs ./node_modules/.bin/knex migrate:latest --knexfile src/config/knexfile.js && node dist/index.js
```

Or set a **Pre-deploy Command:**
```
node -r ./node_modules/tsx/dist/cjs/index.cjs ./node_modules/.bin/knex migrate:latest --knexfile src/config/knexfile.js
```

This runs migrations automatically on every deploy before the server starts.

#### 5. Create Worker service

In Railway dashboard, click **New Service** > **GitHub Repo** (same repo).

Set the **Start Command** to:
```
node dist/engine/worker.js
```

Set the same `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` as the API service.

The worker does not need `PORT`, `CORS_ORIGIN`, or `API_KEY`.

#### 6. Seed production data

After migrations run, seed the initial users and detection rules:

```bash
railway run --service api node -r ./node_modules/tsx/dist/cjs/index.cjs ./node_modules/.bin/knex seed:run --knexfile src/config/knexfile.js
```

Or connect directly via psql and run the seed SQL manually.

---

### Vercel (Frontend)

#### 1. Link the project

```bash
cd apps/web
npx vercel link
# Follow prompts -- creates .vercel/project.json
```

#### 2. Set environment variables in Vercel dashboard

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | Your Railway API URL (e.g. https://fraudscope-api.railway.app) |
| `JWT_ACCESS_SECRET` | Same value as Railway API service |

#### 3. Deploy

```bash
cd apps/web
npx vercel --prod
```

Or push to `main` and let GitHub Actions deploy automatically.

---

### Self-hosted with Docker Compose

For VPS deployment (DigitalOcean, EC2, etc.):

```bash
# On your server
git clone https://github.com/your-username/fraudscope.git
cd fraudscope

# Create production env file
cp .env.example .env.prod
# Edit .env.prod with production values

# Start production stack
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# Run migrations
docker compose -f docker-compose.prod.yml exec api \
  node -r ./node_modules/tsx/dist/cjs/index.cjs \
  ./node_modules/.bin/knex migrate:latest \
  --knexfile src/config/knexfile.js

# Check status
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
```

---

## Environment Variables

### API (`apps/api`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | -- | PostgreSQL connection string |
| `REDIS_URL` | Yes | -- | Redis connection string |
| `JWT_ACCESS_SECRET` | Yes | -- | JWT signing secret (min 16 chars) |
| `JWT_REFRESH_SECRET` | Yes | -- | JWT refresh signing secret |
| `API_KEY` | Yes | -- | API key for transaction ingestion |
| `PORT` | No | `3002` | HTTP port |
| `CORS_ORIGIN` | Yes | -- | Frontend URL for CORS |
| `NODE_ENV` | No | `development` | `development`/`test`/`production` |
| `LOG_LEVEL` | No | `info` | `debug`/`info`/`warn`/`error` |
| `ANALYTICS_CACHE_TTL` | No | `300` | Redis cache TTL in seconds |
| `SIM_ENABLED` | No | `false` | Enable transaction simulator |
| `SIM_RATE` | No | `5` | Simulator transactions per second |
| `SIM_FRAUD_RATIO` | No | `0.10` | Fraction of simulated fraud |

### Web (`apps/web`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Backend API base URL |
| `JWT_ACCESS_SECRET` | Yes | For Edge middleware JWT verification |

---

## CI/CD Pipeline

GitHub Actions runs on every push and PR to `main`.

```
Push/PR to main
      │
      ▼
  test job
  ├── npm ci (api + web)
  ├── ESLint (api + web)
  ├── Spin up PostgreSQL + Redis (services)
  ├── Run migrations
  ├── Jest tests (--runInBand --coverage)
  └── Next.js build
      │
      │ (only on push to main)
      ▼
  deploy job
  ├── Railway deploy (API + Worker)
  └── Vercel deploy (Web)
```

See `docs/ci-setup.md` for secret configuration.

---

## Testing

```bash
# All tests
docker compose exec api sh -c "cd apps/api && npm test"

# Specific test file
docker compose exec api sh -c "cd apps/api && npm test -- tests/auth.test.ts"

# With coverage
docker compose exec api sh -c "cd apps/api && npm test -- --coverage"

# Detect open handles (if Jest hangs)
docker compose exec api sh -c "cd apps/api && npm test -- --detectOpenHandles"
```

**Test coverage areas:**
- Auth (register, login, refresh, protected routes)
- Transactions (ingest, list, detail, pagination)
- Alerts (list, counts, actions, state machine)
- Rules (CRUD, parameter validation, toggle)
- Engine (velocity, amount anomaly, geo mismatch, time anomaly, round amount)
- Alert generation (composite scoring, DB atomicity)

---

## Performance

Query optimization applied to all major database queries. See `docs/query-optimization.md` for full EXPLAIN ANALYZE results.

**Key indexes:**

```sql
-- Transaction list by status (dashboard live feed)
CREATE INDEX idx_tx_status_created ON transactions(status, created_at DESC);

-- Alert queue by risk score
CREATE INDEX idx_alerts_status_score ON alerts(status, risk_score DESC);

-- Audit log date filter (grows unboundedly -- most critical index)
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
```

**All dashboard queries under 10ms on seed dataset (target was 100ms).**

---
