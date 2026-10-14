# FraudScope — Vercel Deployment Migration Guide

## 1. Architecture Overview

FraudScope has been adapted from a dual Railway/Vercel model to a unified Vercel-compatible serverless architecture:

- **Frontend (`apps/web`)**: Next.js 16 app deployed natively to Vercel with Turbopack, client-side React Query, and Socket.io client.
- **Backend API (`apps/api`)**: Express application adapted for Vercel Serverless Functions via [`apps/api/api/index.ts`](file:///Users/HP/Documents/Projects/FraudScope/fraudscope/apps/api/api/index.ts) and [`apps/api/vercel.json`](file:///Users/HP/Documents/Projects/FraudScope/fraudscope/apps/api/vercel.json) rewrites.
- **Rule Engine & Background Processing**:
  - Replaced the continuous polling loop with an event-driven, idempotent processing model.
  - Ingestion retains the `202 Accepted` contract and enqueues transactions into durable queues (Redis Stream + optional `@vercel/queue`).
  - Asynchronous consumer endpoints (`POST /api/v1/engine/process`) execute the fraud rules idempotently, avoiding duplicate alerts upon retries.
  - Periodic sweeper via Vercel Cron (`GET /api/v1/engine/cron`, scheduled every minute in `vercel.json`) processes any un-evaluated transactions to guarantee at-least-once delivery.
- **Real-Time Communication**:
  - Real-time updates utilize Redis Pub/Sub (`tx:live`, `alerts:new`, `alerts:updated`, `rules:updated`) to synchronize state across function instances.
  - WebSocket connections connect directly via `transports: ['websocket']` with automatic reconnection and token refresh.
- **CI/CD (`.github/workflows/ci.yml`)**:
  - Validates linting, migrations, full Jest test suites, and Next.js builds.
  - Automatically deploys both `apps/api` and `apps/web` to their respective Vercel production projects upon merge to `main`.
  - All Railway dependencies have been removed.

---

## 2. Infrastructure & Managed Service Providers

Vercel provides the compute layer for frontend and functions, but persistent storage requires serverless-compatible managed services:

### PostgreSQL
- **Recommended Providers**:
  - [Neon Serverless Postgres](https://neon.tech/) (or Vercel Postgres integration)
  - [Supabase](https://supabase.com/)
  - AWS RDS Aurora Serverless v2
- **Requirements**:
  - PostgreSQL 15+
  - Connection pooling (e.g. Neon connection pooler or PgBouncer) recommended for serverless.
  - SSL enabled (`sslmode=require`).
  - Run migrations explicitly using `npm run migrate:ci` during deployment, **not** during function cold starts.

### Redis
- **Recommended Providers**:
  - [Upstash Redis](https://upstash.com/) (Vercel Marketplace integration)
  - Redis Cloud
  - AWS ElastiCache
- **Requirements**:
  - Redis 7+ with Streams (`XADD`, `XREADGROUP`) and Pub/Sub support.
  - TLS enabled (`rediss://...`).

---

## 3. Environment Variables Specification

### API Project (`apps/api`)

| Variable | Required | Description | Example / Notes |
|---|---|---|---|
| `DATABASE_URL` | Yes | Connection string to PostgreSQL | `postgresql://user:pass@ep-xyz.neon.tech/fraudscope?sslmode=require` |
| `REDIS_URL` | Yes | Connection string to Redis (TLS supported) | `rediss://default:pass@global-redis.upstash.io:6379` |
| `JWT_ACCESS_SECRET` | Yes | HMAC secret for access tokens (min 16 chars) | Strong random 32+ character string |
| `JWT_REFRESH_SECRET` | Yes | HMAC secret for refresh tokens (min 16 chars) | Strong random 32+ character string |
| `API_KEY` | Yes | System API key for transaction ingestion | Machine-to-machine key |
| `CORS_ORIGIN` | Yes | Allowed frontend origin | `https://fraudscope.vercel.app` |
| `NODE_ENV` | Yes | Runtime environment | `production` |
| `PORT` | No | Server port (defaults to 3002) | Unset or `3002` |
| `ENGINE_SECRET` | No | Shared secret for engine webhook endpoints | Random 32+ character string |
| `CRON_SECRET` | No | Vercel Cron authentication secret | Matches Vercel project Cron secret |
| `DB_POOL_MAX` | No | Knex pool limit per serverless instance | Defaults to `10` |

### Web Project (`apps/web`)

| Variable | Required | Description | Example / Notes |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Deployed URL of the API Vercel project | `https://fraudscope-api.vercel.app` |

---

## 4. Vercel Project Configuration

Create two separate projects in Vercel:

### 1. API Project (`fraudscope-api`)
- **Root Directory**: `apps/api`
- **Framework Preset**: `Other`
- **Build Command**: `npm run build`
- **Output Directory**: Leave default
- **Install Command**: `npm install` (monorepo root installs workspaces)
- **Crons**: Automatically read from [`apps/api/vercel.json`](file:///Users/HP/Documents/Projects/FraudScope/fraudscope/apps/api/vercel.json) (`/api/v1/engine/cron`).

### 2. Web Project (`fraudscope-web`)
- **Root Directory**: `apps/web`
- **Framework Preset**: `Next.js`
- **Build Command**: `next build`
- **Output Directory**: Leave default (`.next`)

---

## 5. Migration Execution

Database migrations must run in an explicit deployment step rather than during function invocation:

```bash
# Locally or in CI deployment step:
cd apps/api
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" npm run migrate:ci
```

---

## 6. GitHub Actions Secrets Configuration

Configure the following repository secrets in GitHub Actions (`Settings -> Secrets and variables -> Actions`):

- `VERCEL_TOKEN`: Vercel Personal Access Token or Team Token.
- `VERCEL_ORG_ID`: Organization or Team ID in Vercel.
- `VERCEL_PROJECT_ID_API`: Project ID for `fraudscope-api`.
- `VERCEL_PROJECT_ID_WEB`: Project ID for `fraudscope-web`.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `API_KEY`: Production secrets.
- `DATABASE_URL`, `REDIS_URL`: Production connection strings.
