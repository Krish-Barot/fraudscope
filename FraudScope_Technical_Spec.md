# FraudScope — Complete Technical Specification v2

## What you're building

A real-time transaction monitoring and fraud detection dashboard. Financial transactions flow in via API, get queued through Redis Streams, evaluated by a configurable rule engine, and flagged transactions appear instantly on a live dashboard where analysts triage alerts. Admins manage detection rules, users, and review full audit trails.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 15 (App Router) | SSR, layouts, API route colocaton |
| Styling | Tailwind CSS + shadcn/ui | Consistent enterprise UI components |
| Charts | Recharts | Alert volume, severity breakdown, analytics |
| Maps | Leaflet + OpenStreetMap tiles | Transaction location visualization |
| Real-time | Socket.io (client) | WebSocket connection for live feed |
| Backend API | Node.js + Express.js | REST API server |
| Real-time | Socket.io (server) | Push alerts to dashboard |
| Queue | Redis Streams | Async transaction processing pipeline |
| Pub/Sub | Redis Pub/Sub | Alert broadcast to connected clients |
| Cache | Redis | Velocity counters, analytics cache, sessions |
| Database | PostgreSQL 16 | Transactions, alerts, rules, users, audit |
| ORM/Query | Knex.js | Query builder + migrations |
| Validation | Zod | Request payload validation on all endpoints |
| Auth | JWT (access + refresh) + bcrypt | Authentication + session management |
| Testing | Jest + Supertest | Integration tests |
| API Testing | Postman | Manual endpoint validation |
| DevOps | Docker Compose | Multi-service orchestration |
| CI/CD | GitHub Actions | Lint → test → build → deploy |
| Hosting | Railway or Render | Supports Docker + PostgreSQL + Redis |

---

## Role-Based Access Control (RBAC)

### Two roles:

**Analyst**
- View live transaction feed
- View and filter alert queue
- Take actions on alerts (dismiss, investigate, escalate)
- View transaction details and account history
- View analytics dashboards
- Cannot create/edit detection rules
- Cannot manage users
- Cannot view raw audit logs

**Admin**
- Everything an analyst can do, plus:
- Create, edit, toggle, and delete detection rules
- Create analyst/admin accounts, deactivate users
- View full audit log with search and filters
- View system health and WebSocket connection status
- Export audit logs

---

## Database Schema (Full Detail)

### users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('analyst', 'admin')),
  is_active BOOLEAN DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role) WHERE is_active = true;
```

### transactions
```sql
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id VARCHAR(100) UNIQUE NOT NULL,  -- from source system
  account_id VARCHAR(50) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'CAD',
  merchant_name VARCHAR(255),
  merchant_category VARCHAR(100),  -- MCC code or category
  country_code VARCHAR(3) NOT NULL,
  city VARCHAR(100),
  ip_address INET,
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  channel VARCHAR(20) CHECK (channel IN ('online', 'pos', 'atm', 'mobile', 'wire')),
  status VARCHAR(20) DEFAULT 'clean' CHECK (status IN ('clean', 'flagged', 'blocked')),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tx_account_created ON transactions(account_id, created_at DESC);
CREATE INDEX idx_tx_status_created ON transactions(status, created_at DESC);
CREATE INDEX idx_tx_amount ON transactions(amount) WHERE amount > 1000;
CREATE INDEX idx_tx_country ON transactions(country_code, created_at DESC);
CREATE INDEX idx_tx_created ON transactions(created_at DESC);
```

### rules
```sql
CREATE TABLE rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  type VARCHAR(30) NOT NULL CHECK (type IN (
    'velocity', 'amount_anomaly', 'geo_mismatch',
    'time_anomaly', 'round_amount'
  )),
  parameters JSONB NOT NULL,  -- rule-specific config
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  score_weight INTEGER NOT NULL DEFAULT 20 CHECK (score_weight BETWEEN 5 AND 40),
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### alerts
```sql
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'dismissed', 'escalated', 'investigating')),
  assigned_to UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_alerts_status_score ON alerts(status, risk_score DESC);
CREATE INDEX idx_alerts_severity ON alerts(severity, created_at DESC);
CREATE INDEX idx_alerts_tx ON alerts(transaction_id);
CREATE INDEX idx_alerts_assigned ON alerts(assigned_to) WHERE status IN ('reviewing', 'investigating');
```

### alert_rules (which rules triggered for each alert)
```sql
CREATE TABLE alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES rules(id),
  score_contribution INTEGER NOT NULL,
  details JSONB NOT NULL,  -- rule-specific explanation
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alert_rules_alert ON alert_rules(alert_id);
CREATE INDEX idx_alert_rules_rule ON alert_rules(rule_id);
```

### alert_actions
```sql
CREATE TABLE alert_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  analyst_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(20) NOT NULL CHECK (action IN ('dismiss', 'escalate', 'investigate', 'reassign', 'comment')),
  reason TEXT NOT NULL,
  previous_status VARCHAR(20),
  new_status VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alert_actions_alert ON alert_actions(alert_id);
CREATE INDEX idx_alert_actions_analyst ON alert_actions(analyst_id, created_at DESC);
```

### audit_logs
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL,
  actor_id UUID REFERENCES users(id),  -- NULL for system events
  actor_type VARCHAR(20) DEFAULT 'user' CHECK (actor_type IN ('user', 'system', 'api')),
  target_type VARCHAR(30),  -- 'transaction', 'alert', 'rule', 'user'
  target_id UUID,
  payload JSONB,
  ip_address INET,
  source VARCHAR(50),  -- 'api', 'dashboard', 'engine', 'scheduler'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_event ON audit_logs(event_type, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_audit_target ON audit_logs(target_type, target_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
```

---

## Redis Key Patterns

```
# Velocity tracking (per-account transaction count within time window)
velocity:{account_id}         → INT (auto-expire via TTL matching rule window)

# Account's recent countries (for geo mismatch)
geo:{account_id}:countries    → LIST of last N country codes

# Account's rolling average spend (cached for amount anomaly)
avg:{account_id}              → STRING (decimal) with 1-hour TTL

# Transaction processing queue
STREAM: tx:incoming           → Redis Stream for unprocessed transactions

# Real-time alert broadcast
PUBSUB: alerts:new            → New alert notifications
PUBSUB: alerts:updated        → Alert status changes (when analyst acts)
PUBSUB: tx:live               → Live transaction feed for dashboard

# Analytics cache
cache:analytics:volume:{range}     → JSON string, 5-min TTL
cache:analytics:severity:{range}   → JSON string, 5-min TTL
cache:analytics:rules:{range}      → JSON string, 5-min TTL
cache:analytics:accounts:{range}   → JSON string, 5-min TTL

# Session tracking
session:{user_id}:active      → STRING with 30-min TTL (tracks active analysts)

# Rate limiting (API ingestion)
ratelimit:{api_key}           → INT with 1-min TTL (max 100 tx/min per key)
```

---

## WebSocket Events

### Server → Client (Push)

```javascript
// New transaction arrives (live feed)
socket.emit('tx:new', {
  id: 'uuid',
  account_id: 'ACC-4821',
  amount: 2340.00,
  currency: 'CAD',
  merchant: 'Electronics Plus',
  country: 'CA',
  status: 'clean',       // or 'flagged'
  risk_score: null,       // or 0-100 if flagged
  created_at: '2026-07-15T14:23:11Z'
});

// New alert generated
socket.emit('alert:new', {
  id: 'uuid',
  transaction_id: 'uuid',
  risk_score: 78,
  severity: 'high',
  triggered_rules: ['velocity', 'geo_mismatch'],
  transaction: {
    account_id: 'ACC-4821',
    amount: 2340.00,
    merchant: 'Electronics Plus',
    country: 'NG'
  },
  created_at: '2026-07-15T14:23:12Z'
});

// Alert status updated (another analyst acted)
socket.emit('alert:updated', {
  alert_id: 'uuid',
  new_status: 'dismissed',
  analyst: 'jane.doe@company.com',
  action: 'dismiss',
  reason: 'Known travel — customer confirmed',
  updated_at: '2026-07-15T14:25:00Z'
});

// Metric update (dashboard cards)
socket.emit('metrics:update', {
  transactions_today: 12847,
  alerts_today: 23,
  pending_review: 8,
  avg_response_time_seconds: 272
});

// Connection status
socket.emit('system:status', {
  engine_healthy: true,
  redis_connected: true,
  db_connected: true,
  active_analysts: 3
});
```

### Client → Server

```javascript
// Join specific rooms
socket.emit('subscribe', { channels: ['tx:live', 'alerts'] });

// Analyst starts reviewing an alert (locks it)
socket.emit('alert:claim', { alert_id: 'uuid' });

// Unsubscribe from live feed (reduce bandwidth)
socket.emit('unsubscribe', { channels: ['tx:live'] });
```

---

## API Routes (Complete)

### Authentication
| Method | Route | Auth | Request Body | Response |
|--------|-------|------|-------------|----------|
| POST | /api/v1/auth/register | Admin | `{ email, password, first_name, last_name, role }` | `{ user, token }` |
| POST | /api/v1/auth/login | Public | `{ email, password }` | `{ user, access_token, refresh_token }` |
| POST | /api/v1/auth/refresh | Refresh token | `{ refresh_token }` | `{ access_token }` |
| POST | /api/v1/auth/logout | Auth | — | `{ success }` |
| GET | /api/v1/auth/me | Auth | — | `{ user }` |

### Transactions
| Method | Route | Auth | Query/Body | Response |
|--------|-------|------|-----------|----------|
| POST | /api/v1/transactions | API Key | Transaction payload | `{ transaction, queued: true }` |
| POST | /api/v1/transactions/batch | API Key | `{ transactions: [...] }` (max 100) | `{ accepted, rejected, errors }` |
| GET | /api/v1/transactions | Analyst | `?status=flagged&min_amount=1000&country=NG&page=1&limit=25&sort=created_at:desc` | `{ data, pagination }` |
| GET | /api/v1/transactions/:id | Analyst | — | `{ transaction, alerts, account_history }` |
| GET | /api/v1/transactions/:id/timeline | Analyst | — | `{ recent_transactions }` (same account, last 20) |

### Alerts
| Method | Route | Auth | Query/Body | Response |
|--------|-------|------|-----------|----------|
| GET | /api/v1/alerts | Analyst | `?status=new&severity=critical,high&sort=risk_score:desc&page=1&limit=25` | `{ data, pagination, counts }` |
| GET | /api/v1/alerts/:id | Analyst | — | `{ alert, transaction, triggered_rules, actions }` |
| POST | /api/v1/alerts/:id/actions | Analyst | `{ action: 'dismiss'\|'escalate'\|'investigate', reason: '...' }` | `{ alert, action }` |
| PATCH | /api/v1/alerts/:id/assign | Analyst | `{ analyst_id }` | `{ alert }` |
| GET | /api/v1/alerts/counts | Analyst | — | `{ new, reviewing, dismissed_today, escalated_today }` |

### Rules (Admin only)
| Method | Route | Auth | Body | Response |
|--------|-------|------|------|----------|
| GET | /api/v1/rules | Analyst | — | `{ rules }` (analysts can view, not edit) |
| GET | /api/v1/rules/:id | Analyst | — | `{ rule, stats }` |
| POST | /api/v1/rules | Admin | `{ name, description, type, parameters, severity, score_weight }` | `{ rule }` |
| PUT | /api/v1/rules/:id | Admin | Full rule object | `{ rule }` |
| PATCH | /api/v1/rules/:id/toggle | Admin | `{ is_active }` | `{ rule }` |
| DELETE | /api/v1/rules/:id | Admin | — | `{ deleted }` |
| GET | /api/v1/rules/:id/stats | Admin | `?range=7d` | `{ trigger_count, false_positive_rate, avg_score }` |

### Users (Admin only)
| Method | Route | Auth | Body | Response |
|--------|-------|------|------|----------|
| GET | /api/v1/users | Admin | — | `{ users }` |
| GET | /api/v1/users/:id | Admin | — | `{ user, stats }` |
| POST | /api/v1/users | Admin | `{ email, first_name, last_name, role }` | `{ user, temp_password }` |
| PATCH | /api/v1/users/:id | Admin | `{ role, is_active }` | `{ user }` |
| GET | /api/v1/users/:id/activity | Admin | `?range=7d` | `{ alerts_reviewed, avg_response_time, actions }` |

### Analytics
| Method | Route | Auth | Query | Response |
|--------|-------|------|-------|----------|
| GET | /api/v1/analytics/overview | Analyst | `?range=24h` | `{ tx_count, alert_count, pending, avg_response }` |
| GET | /api/v1/analytics/alert-volume | Analyst | `?range=7d&interval=hour` | `{ timeseries: [{ timestamp, count, severity_breakdown }] }` |
| GET | /api/v1/analytics/severity | Analyst | `?range=30d` | `{ low, medium, high, critical, total }` |
| GET | /api/v1/analytics/rules | Analyst | `?range=30d` | `{ rules: [{ name, triggers, false_positives, rate }] }` |
| GET | /api/v1/analytics/accounts | Analyst | `?range=30d&limit=10` | `{ accounts: [{ id, alert_count, total_flagged, last_alert }] }` |
| GET | /api/v1/analytics/analysts | Admin | `?range=30d` | `{ analysts: [{ name, reviewed, avg_time, escalation_rate }] }` |
| GET | /api/v1/analytics/resolution | Analyst | `?range=30d` | `{ timeseries: [{ date, dismissed, escalated, investigating }] }` |

### Audit Logs (Admin only)
| Method | Route | Auth | Query | Response |
|--------|-------|------|-------|----------|
| GET | /api/v1/audit-logs | Admin | `?event_type=alert.dismissed&actor_id=uuid&target_type=alert&page=1&limit=50` | `{ data, pagination }` |
| GET | /api/v1/audit-logs/export | Admin | `?range=30d&format=csv` | CSV file download |

### System Health
| Method | Route | Auth | Response |
|--------|-------|------|----------|
| GET | /api/v1/health | Public | `{ api: 'ok', db: 'ok', redis: 'ok', engine: 'ok' }` |
| GET | /api/v1/health/detailed | Admin | `{ ...above, queue_depth, active_connections, uptime }` |

---

## Middleware Stack

```javascript
// Order matters — applied in this sequence on every request

1. requestId        // Attach UUID to every request (for tracing)
2. requestLogger    // Log method, path, status, duration
3. rateLimiter      // Check Redis counter, reject if over limit
4. cors             // Allow dashboard origin
5. bodyParser       // JSON body parsing with 1MB limit
6. authenticate     // Verify JWT, attach user to req
7. authorize(role)  // Check user.role against required role
8. validate(schema) // Zod validation of req.body/query/params
9. [route handler]  // Your controller
10. auditLog        // Write to audit_logs table (post-response)
11. errorHandler    // Catch all errors, format response, log
```

### Error Response Format
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid transaction payload",
    "details": [
      { "field": "amount", "message": "Must be a positive number" },
      { "field": "country_code", "message": "Must be a valid ISO 3166-1 alpha-2 code" }
    ],
    "request_id": "req-uuid-here",
    "timestamp": "2026-07-15T14:23:11Z"
  }
}
```

### Error Codes
| Code | HTTP Status | Meaning |
|------|------------|---------|
| VALIDATION_ERROR | 400 | Zod validation failed |
| UNAUTHORIZED | 401 | Missing or invalid token |
| FORBIDDEN | 403 | Role doesn't have permission |
| NOT_FOUND | 404 | Resource doesn't exist |
| CONFLICT | 409 | Duplicate (email, external_id) |
| RATE_LIMITED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Unexpected server error |

---

## Rule Engine — Detailed Logic

### How the pipeline works (step by step):

```
1. POST /api/v1/transactions receives payload
2. Validate with Zod → reject if invalid
3. Insert into PostgreSQL (status: 'clean')
4. Push to Redis Stream 'tx:incoming' (XADD)
5. Publish to Redis PubSub 'tx:live' (for dashboard live feed)
6. Write to audit_logs (event: 'transaction.ingested')
7. Return 202 Accepted { transaction, queued: true }

--- Worker process (separate from API) ---

8. Worker reads from Redis Stream (XREAD with blocking)
9. For each transaction:
   a. Fetch all active rules from DB (cache in memory, refresh every 60s)
   b. Run each rule's evaluate() function
   c. Collect all triggered rules with their scores
   d. Calculate composite_score = sum(triggered_scores), cap at 100
   e. Determine severity from score:
      - 0-19: no alert
      - 20-39: low
      - 40-59: medium
      - 60-79: high
      - 80-100: critical
   f. If score >= 20:
      - Update transaction status to 'flagged' in PostgreSQL
      - Insert into alerts table
      - Insert into alert_rules table (one row per triggered rule)
      - Write to audit_logs (event: 'alert.generated')
      - Publish to Redis PubSub 'alerts:new'
   g. ACK the message in Redis Stream (XACK)
```

### Rule interface (every rule implements this):

```javascript
// src/engine/rules/velocity.ts

const Zod = require('zod');

const parameterSchema = z.object({
  max_count: z.number().int().min(1).max(100),
  window_minutes: z.number().int().min(1).max(1440),
});

async function evaluate(transaction, parameters, { redis, db }) {
  const { max_count, window_minutes } = parameters;
  const key = `velocity:${transaction.account_id}`;
  const ttl = window_minutes * 60;

  // Increment counter (atomic)
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, ttl);
  }

  const triggered = count > max_count;

  return {
    triggered,
    score: triggered ? 25 : 0,  // base score, multiplied by rule's score_weight
    details: {
      rule_type: 'velocity',
      current_count: count,
      threshold: max_count,
      window_minutes,
      message: triggered
        ? `${count} transactions in ${window_minutes} minutes (threshold: ${max_count})`
        : null
    }
  };
}

module.exports = { evaluate, parameterSchema };
```

### All 5 rules — parameter schemas and logic:

**velocity**
```json
{ "max_count": 5, "window_minutes": 10 }
```
Logic: Redis INCR with TTL. Count transactions per account within window.

**amount_anomaly**
```json
{ "multiplier": 3.0, "min_amount": 500 }
```
Logic: Query PostgreSQL for account's avg(amount) over last 30 days. If current amount > avg × multiplier AND amount > min_amount → trigger. Cache average in Redis with 1-hour TTL.

**geo_mismatch**
```json
{ "lookback_count": 5, "alert_on_new_country": true }
```
Logic: Query last N transactions for account. If current country not in the set → trigger. Store recent countries in Redis LIST, LPUSH + LTRIM to keep N entries.

**time_anomaly**
```json
{ "suspicious_start_hour": 2, "suspicious_end_hour": 5, "timezone": "America/Toronto" }
```
Logic: Convert transaction timestamp to account's timezone. If hour falls within suspicious window → trigger.

**round_amount**
```json
{ "min_amount": 1000, "tolerance": 0.0 }
```
Logic: If amount >= min_amount AND amount % 100 === 0 → trigger. Optional tolerance for near-round amounts (e.g., $999.99).

---

## Transaction Simulator — Detailed

```javascript
// src/simulator/index.ts

// Configurable via env vars
const RATE = process.env.SIM_RATE || 5;         // transactions per second
const FRAUD_RATIO = process.env.SIM_FRAUD || 0.1; // 10% suspicious

// Normal transaction generator
function generateNormal(account) {
  return {
    external_id: `SIM-${uuid()}`,
    account_id: account.id,
    amount: randomBetween(account.min_spend, account.max_spend),
    currency: account.currency,
    merchant_name: randomFrom(merchants),
    merchant_category: randomFrom(categories),
    country_code: account.home_country,
    city: account.home_city,
    ip_address: randomIP(account.home_country),
    latitude: jitter(account.lat, 0.05),
    longitude: jitter(account.lng, 0.05),
    channel: weightedRandom({ online: 0.4, pos: 0.3, mobile: 0.25, atm: 0.05 }),
  };
}

// Suspicious transaction generator (picks 1-3 fraud patterns)
function generateSuspicious(account) {
  const tx = generateNormal(account);
  const patterns = pickRandom(fraudPatterns, randomBetween(1, 3));

  for (const pattern of patterns) {
    switch (pattern) {
      case 'high_amount':
        tx.amount = account.max_spend * randomBetween(5, 20);
        break;
      case 'foreign_country':
        tx.country_code = randomFrom(highRiskCountries);
        tx.city = null;
        break;
      case 'odd_hour':
        tx.created_at = setHour(tx.created_at, randomBetween(2, 4));
        break;
      case 'round_amount':
        tx.amount = roundTo(randomBetween(1000, 10000), 100);
        break;
      case 'rapid_fire':
        // Queue 5-8 transactions for same account within 2 minutes
        return generateBurst(account, randomBetween(5, 8));
    }
  }
  return tx;
}

// 100 mock accounts with profiles
const accounts = generateAccounts(100, {
  countries: ['CA', 'US', 'GB', 'AU'],
  spend_ranges: [
    { min: 5, max: 50, weight: 0.4 },      // low spenders
    { min: 20, max: 200, weight: 0.35 },    // medium
    { min: 100, max: 2000, weight: 0.2 },   // high
    { min: 500, max: 10000, weight: 0.05 }, // premium
  ]
});
```

---

## Sprint Plan (Expanded)

### Sprint 1: Foundation (Week 1)
**Days 1-2:** Docker Compose + database migrations + seed data
**Days 3-4:** Transaction ingestion API (POST + GET + GET/:id) with Zod validation
**Days 5:** Transaction simulator + basic integration tests
**Deliverable:** `docker compose up` runs everything. Simulator pumps transactions. API returns them.

### Sprint 2: Rule Engine (Week 2)
**Days 1-2:** Redis Stream consumer worker + rule interface
**Days 3-4:** Implement all 5 rules + composite scoring + alert generation
**Day 5:** Rules CRUD API (admin-only) + integration tests for each rule
**Deliverable:** Transactions get evaluated. Alerts appear in the database. Rules are configurable via API.

### Sprint 3: Dashboard + Real-time (Week 3)
**Days 1-2:** Next.js layout (sidebar, top bar, auth pages) + JWT auth flow
**Days 3-4:** Live feed page + alert queue page + Socket.io integration
**Days 5:** Transaction detail page + alert actions (dismiss/escalate/investigate) + audit logging
**Deliverable:** Analysts can log in, see live transactions, review alerts, and take actions.

### Sprint 4: Admin + Analytics (Week 4)
**Days 1-2:** Admin pages (rule manager, user management, audit logs)
**Days 3-4:** Analytics dashboard (charts, metrics, date range filters)
**Day 5:** Performance optimization (indexing, caching) + deployment + CI/CD
**Deliverable:** Full app deployed. Admins manage rules and users. Analytics show system health.

---

## Admin Pages (Detailed)

### Rule Manager (/dashboard/admin/rules)
- Table of all rules: name, type, severity, parameters preview, hit rate %, active toggle
- Click rule → expanded view with:
  - Full parameter editor (form fields change based on rule type)
  - 7-day trigger chart (how often this rule fires)
  - False positive rate (dismissed alerts ÷ total alerts for this rule)
  - Last triggered timestamp
- "Create rule" button → modal with:
  - Name (text input, required)
  - Description (textarea, optional)
  - Type (dropdown → changes parameter fields dynamically)
  - Parameters (dynamic form based on type)
  - Severity (dropdown: low/medium/high/critical)
  - Score weight (slider: 5-40, default 20)
  - Active toggle (default: on)
- Delete rule → confirmation modal with warning about how many alerts it generated

### User Management (/dashboard/admin/users)
- Table: name, email, role badge, status, last login, alerts reviewed (last 30d)
- "Invite analyst" button → modal with:
  - Email, first name, last name, role dropdown
  - Generates temporary password shown once
- Edit user → change role (analyst ↔ admin) or deactivate
- Deactivate (not delete) — maintains audit trail integrity
- Show each user's stats: alerts reviewed, avg response time, escalation rate

### Audit Logs (/dashboard/admin/audit)
- Search bar: search by event type, user email, or target ID
- Filters: event type dropdown (transaction.ingested, alert.generated, alert.dismissed, alert.escalated, rule.created, rule.updated, user.created, user.login), date range, actor
- Table: timestamp (monospaced), event type (colored badge), actor name, target (clickable link to transaction/alert/rule), details (truncated, expandable)
- Export button → downloads CSV for selected date range

### System Health (/dashboard/admin/system)
- Service status cards: API (green/red), PostgreSQL (green/red), Redis (green/red), Engine Worker (green/red)
- Real-time metrics: queue depth (pending transactions), WebSocket connections, active analysts, transactions processed/minute
- Uptime display

---

## Testing Plan

### Integration Tests (Jest + Supertest)

**Auth tests (6 tests):**
- Register with valid data → 201
- Register with duplicate email → 409
- Register as analyst (non-admin) → 403
- Login with valid credentials → 200 + tokens
- Login with wrong password → 401
- Access protected route without token → 401

**Transaction tests (8 tests):**
- Ingest valid transaction → 202 + queued
- Ingest with missing required fields → 400
- Ingest batch (5 valid) → 202 + all accepted
- Ingest batch with 2 invalid → 202 + partial (3 accepted, 2 rejected)
- List transactions with pagination → 200 + correct page
- List with status filter → 200 + only flagged
- Get transaction by ID → 200
- Get non-existent transaction → 404

**Rule engine tests (10 tests):**
- Velocity rule triggers on 6th transaction in window → alert created
- Velocity rule doesn't trigger on 5th transaction → no alert
- Amount anomaly triggers on 4x average → alert created
- Amount anomaly doesn't trigger below threshold → no alert
- Geo mismatch triggers on new country → alert created
- Geo mismatch doesn't trigger on known country → no alert
- Time anomaly triggers at 3 AM → alert created
- Round amount triggers on $5,000.00 → alert created
- Multiple rules trigger → composite score calculated correctly
- Score >= 80 → severity is 'critical'

**Alert tests (6 tests):**
- Dismiss alert with reason → status updated + audit log written
- Escalate alert → status updated + audit log written
- Action without reason → 400
- Action on non-existent alert → 404
- Analyst cannot access admin routes → 403
- Alert counts endpoint returns correct numbers

### Postman Collection
- Organize by folder: Auth, Transactions, Rules, Alerts, Analytics, Admin
- 40+ manually validated scenarios
- Environment variables for base_url, access_token, admin_token
- Pre-request scripts for auto-login

---

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://fraudscope:password@localhost:5432/fraudscope
DB_POOL_MIN=2
DB_POOL_MAX=10

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_ACCESS_SECRET=your-access-secret
JWT_REFRESH_SECRET=your-refresh-secret
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# API
PORT=3001
CORS_ORIGIN=http://localhost:3000
API_KEY=your-ingestion-api-key

# Engine
ENGINE_POLL_INTERVAL=100         # ms between Redis Stream reads
ENGINE_BATCH_SIZE=10             # transactions per read
RULE_CACHE_TTL=60                # seconds to cache active rules

# Simulator
SIM_ENABLED=false                # don't run in production
SIM_RATE=5                       # transactions per second
SIM_FRAUD_RATIO=0.10             # 10% suspicious

# Analytics
ANALYTICS_CACHE_TTL=300          # 5 minutes

# App
NODE_ENV=development
LOG_LEVEL=debug
```

---

## Folder Structure

```
fraudscope/
├── docker-compose.yml
├── .github/
│   └── workflows/
│       └── ci.yml
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── config/           # DB, Redis, env validation
│   │   │   ├── middleware/       # auth, rbac, error handler, audit
│   │   │   ├── modules/
│   │   │   │   ├── auth/         # controller, service, routes, schema
│   │   │   │   ├── transactions/ # controller, service, routes, schema
│   │   │   │   ├── rules/        # controller, service, routes, schema
│   │   │   │   ├── alerts/       # controller, service, routes, schema
│   │   │   │   └── analytics/    # controller, service, routes
│   │   │   ├── engine/
│   │   │   │   ├── worker.ts     # Redis Stream consumer
│   │   │   │   ├── scorer.ts     # Composite risk score calculator
│   │   │   │   └── rules/
│   │   │   │       ├── velocity.ts
│   │   │   │       ├── amountAnomaly.ts
│   │   │   │       ├── geoMismatch.ts
│   │   │   │       ├── timeAnomaly.ts
│   │   │   │       └── roundAmount.ts
│   │   │   ├── websocket/        # Socket.io setup + Redis sub
│   │   │   └── simulator/        # Mock transaction generator
│   │   ├── tests/
│   │   │   ├── auth.test.ts
│   │   │   ├── transactions.test.ts
│   │   │   ├── rules.test.ts
│   │   │   └── engine.test.ts
│   │   ├── migrations/
│   │   ├── seeds/
│   │   ├── Dockerfile
│   │   └── package.json
│   └── web/
│       ├── app/
│       │   ├── (auth)/
│       │   │   └── login/
│       │   ├── dashboard/
│       │   │   ├── page.tsx        # Live feed
│       │   │   ├── alerts/
│       │   │   ├── transactions/
│       │   │   ├── rules/
│       │   │   └── analytics/
│       │   └── layout.tsx
│       ├── components/
│       │   ├── LiveFeed.tsx
│       │   ├── AlertCard.tsx
│       │   ├── RiskBadge.tsx
│       │   ├── TransactionMap.tsx
│       │   └── charts/
│       ├── hooks/
│       │   └── useSocket.ts
│       ├── lib/
│       │   └── api.ts
│       ├── Dockerfile
│       └── package.json
├── README.md
└── docs/
    └── api.md

```

---

## Feature Breakdown (by Sprint)

### Sprint 1: Foundation (Week 1)
**Goal:** Docker environment, database, basic API, transaction ingestion

#### Tasks:
1. **Docker Compose setup**
   - PostgreSQL 16, Redis 7, Node.js API server
   - Health checks on all services
   - Named volumes for data persistence
   - Single `docker compose up` to run everything

2. **Database migrations**
   - `users` table (id, email, password_hash, role, created_at)
   - `transactions` table (id, account_id, amount, currency, merchant, country, ip_address, lat, lng, status, created_at)
   - `rules` table (id, name, type, parameters JSONB, is_active, severity, created_at)
   - `alerts` table (id, transaction_id, rule_id, severity, risk_score, rule_details JSONB, status, created_at)
   - `alert_actions` table (id, alert_id, analyst_id, action, reason, created_at)
   - `audit_logs` table (id, transaction_id, event_type, payload JSONB, source, created_at)

3. **Transaction ingestion API**
   - `POST /api/v1/transactions` — receive a transaction, validate with Zod, write to PostgreSQL, push to Redis Stream
   - `GET /api/v1/transactions` — list with pagination, filtering by status/amount/date
   - `GET /api/v1/transactions/:id` — single transaction with related alerts

4. **Transaction simulator**
   - Node.js script that generates mock transactions at configurable rate (1-10 per second)
   - Mix of normal transactions (90%) and suspicious ones (10%)
   - Suspicious patterns: unusually large amounts, rapid-fire from same account, country hopping, round-number amounts, late-night timing

5. **Seed data**
   - 100 mock accounts with realistic profiles (name, country, typical spend range)
   - Pre-load 1000 historical transactions for analytics

#### Resume bullet this earns:
> "Configured a Docker Compose environment orchestrating PostgreSQL, Redis, and Node.js services with health checks, and built a transaction ingestion API with Zod validation processing mock financial data at 10 transactions/second."

---

### Sprint 2: Rule Engine (Week 2)
**Goal:** Fraud detection rules, risk scoring, alert generation

#### Tasks:
1. **Rule engine worker**
   - Consumes transactions from Redis Stream
   - Runs each transaction through all active rules
   - Computes a composite risk score (0-100)
   - If score exceeds threshold → create alert in PostgreSQL
   - Push alert to Redis Pub/Sub channel `alerts:new`

2. **Built-in detection rules:**

   **Velocity check** (type: `velocity`)
   - "More than N transactions from same account in X minutes"
   - Uses Redis INCR with TTL to track per-account transaction count
   - Parameters: `{ max_count: 5, window_minutes: 10 }`
   - Example: 6 transactions from account A in 8 minutes → flag

   **Amount anomaly** (type: `amount_anomaly`)
   - "Transaction amount exceeds X times the account's average"
   - Queries PostgreSQL for account's rolling average (last 30 days)
   - Parameters: `{ multiplier: 3.0, min_amount: 500 }`
   - Example: Average spend is $45, transaction is $2,300 → flag

   **Geographic mismatch** (type: `geo_mismatch`)
   - "Transaction from country different than last N transactions"
   - Checks the last 5 transactions for the account
   - Parameters: `{ lookback_count: 5, alert_on_new_country: true }`
   - Example: 5 transactions from Canada, then one from Nigeria → flag

   **Time anomaly** (type: `time_anomaly`)
   - "Transaction outside account's typical hours"
   - Parameters: `{ suspicious_start: 2, suspicious_end: 5 }` (2 AM - 5 AM local)
   - Example: Account normally transacts 9 AM - 6 PM, transaction at 3 AM → flag

   **Round amount** (type: `round_amount`)
   - "Exact round amounts above threshold"
   - Parameters: `{ min_amount: 1000 }`
   - Example: Exactly $5,000.00 → flag (legitimate purchases are rarely exact)

3. **Risk score calculation**
   - Each rule returns a partial score (0-25 based on severity)
   - Composite score = sum of all triggered rule scores, capped at 100
   - Severity classification: Low (20-39), Medium (40-59), High (60-79), Critical (80-100)

4. **Rules CRUD API**
   - `GET /api/v1/rules` — list all rules
   - `POST /api/v1/rules` — create custom rule
   - `PATCH /api/v1/rules/:id` — update parameters or toggle active/inactive
   - Validate rule parameters with Zod

5. **Integration tests**
   - Test each rule type with known-fraudulent and known-clean transactions
   - Test composite scoring with multiple rules triggering
   - Test Redis Stream consumption and alert creation

#### Resume bullet this earns:
> "Built a configurable rule engine that evaluates transactions against 5 fraud detection patterns (velocity, amount anomaly, geographic mismatch, time anomaly, round amounts), computing composite risk scores and generating real-time alerts via Redis Pub/Sub."

---

### Sprint 3: Real-time Dashboard (Week 3)
**Goal:** Live monitoring UI, alert management, WebSocket push

#### Tasks:
1. **WebSocket server**
   - Socket.io server subscribes to Redis Pub/Sub `alerts:new` channel
   - Pushes new alerts to all connected dashboard clients
   - Also pushes live transaction feed (configurable: all vs flagged-only)

2. **Dashboard pages:**

   **Live feed** (`/dashboard`)
   - Real-time scrolling list of incoming transactions
   - Flagged transactions highlighted by severity (yellow/orange/red)
   - Click any transaction to see full details + triggered rules
   - Filter: all / flagged only / by severity level

   **Alert queue** (`/dashboard/alerts`)
   - List of unreviewed alerts, sorted by risk score (highest first)
   - Each alert card shows: transaction details, triggered rules, risk score, timestamp
   - Action buttons: Dismiss (false positive), Escalate (confirmed fraud), Investigate (needs more info)
   - Analyst must provide a reason when taking action → creates audit trail

   **Transaction detail** (`/dashboard/transactions/:id`)
   - Full transaction info
   - Map showing transaction location (use Leaflet with free tiles)
   - Timeline of account's recent transactions
   - List of all rules that fired with individual scores

   **Rule manager** (`/dashboard/rules`)
   - Table of all detection rules
   - Toggle active/inactive
   - Edit parameters inline
   - See how many alerts each rule has generated (hit rate)

3. **Alert action API**
   - `POST /api/v1/alerts/:id/action` — analyst takes action (dismiss/escalate/investigate)
   - Requires analyst_id and reason
   - Creates audit_log entry
   - Updates alert status

4. **Auth flow**
   - `POST /api/v1/auth/register` — create analyst account (admin-only)
   - `POST /api/v1/auth/login` — JWT token
   - RBAC: `analyst` (can review alerts), `admin` (can manage rules + users)
   - Protected routes with middleware

#### Resume bullet this earns:
> "Developed a real-time fraud monitoring dashboard using Next.js and Socket.io, displaying live transaction feeds and alert queues pushed via Redis Pub/Sub, with RBAC-protected analyst workflows for alert triage and audit-logged decision tracking."

---

### Sprint 4: Analytics & Polish (Week 4)
**Goal:** Charts, metrics, performance optimization, deployment

#### Tasks:
1. **Analytics dashboard** (`/dashboard/analytics`)
   - **Alert volume chart** — alerts per hour/day (Recharts line chart)
   - **Severity breakdown** — pie chart of Low/Medium/High/Critical
   - **Rule effectiveness** — bar chart showing which rules fire most + false positive rate
   - **Top flagged accounts** — table of accounts with most alerts
   - **Response time** — average time from alert creation to analyst action
   - Date range picker for all charts

2. **Analytics API**
   - `GET /api/v1/analytics/alert-volume?range=7d` — time-series data
   - `GET /api/v1/analytics/severity-breakdown?range=30d`
   - `GET /api/v1/analytics/rule-effectiveness`
   - `GET /api/v1/analytics/top-accounts?limit=10`
   - PostgreSQL aggregation queries with proper indexing

3. **Performance optimization**
   - Add compound indexes on transactions (account_id + created_at), alerts (status + created_at)
   - Cache analytics queries in Redis with 5-minute TTL
   - Benchmark with `EXPLAIN ANALYZE` and document improvements

4. **Deployment**
   - Dockerize for production
   - Deploy to Railway or Render (supports Docker + PostgreSQL + Redis)
   - GitHub Actions CI/CD: lint → test → build → deploy
   - Environment variable validation on startup

5. **Documentation**
   - README with architecture diagram
   - API documentation (route, method, request/response shapes)
   - Setup instructions (docker compose up)

#### Resume bullet this earns:
> "Optimized PostgreSQL analytics queries with compound indexing and Redis caching (5-min TTL), reducing dashboard load times, and deployed the full stack via Docker with GitHub Actions CI/CD."

---

## API Route Summary

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/v1/auth/register | Admin | Create analyst account |
| POST | /api/v1/auth/login | Public | Get JWT token |
| POST | /api/v1/transactions | API Key | Ingest transaction |
| GET | /api/v1/transactions | Analyst | List with filters |
| GET | /api/v1/transactions/:id | Analyst | Transaction detail |
| GET | /api/v1/rules | Analyst | List rules |
| POST | /api/v1/rules | Admin | Create rule |
| PATCH | /api/v1/rules/:id | Admin | Update rule |
| GET | /api/v1/alerts | Analyst | Alert queue |
| GET | /api/v1/alerts/:id | Analyst | Alert detail |
| POST | /api/v1/alerts/:id/action | Analyst | Take action |
| GET | /api/v1/analytics/* | Analyst | Analytics endpoints |

---

## Final Resume Bullets (After Full Build)

**FraudScope — Real-time Transaction Anomaly Dashboard** (Next.js, Node.js, PostgreSQL, Redis, Docker)

- Engineered a real-time fraud detection pipeline processing transactions via REST API → Redis Streams → rule engine worker, evaluating against 5 configurable detection patterns (velocity, amount anomaly, geographic mismatch, time anomaly, round amounts) and computing composite risk scores from 0–100.
- Built a live monitoring dashboard using Next.js and Socket.io, displaying real-time transaction feeds and prioritized alert queues pushed via Redis Pub/Sub, with RBAC-protected analyst workflows for alert triage and mandatory audit logging on every action.
- Implemented admin controls for detection rule management (CRUD + toggle + effectiveness metrics), user administration, and searchable audit logs with CSV export — enforcing role-based access across analyst and admin permission tiers.
- Optimized PostgreSQL analytics queries with compound indexing and Redis caching (5-min TTL), containerized the full stack using Docker Compose with health checks, and deployed via GitHub Actions CI/CD.
- Wrote 30 integration tests (Jest + Supertest) covering auth, transaction ingestion, rule evaluation, and alert workflows, and validated 40+ API scenarios via Postman.

---