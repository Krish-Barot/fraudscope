# FraudScope API Reference

Base URL: `https://your-api.railway.app` (production) or `http://localhost:3002` (development)

All endpoints return JSON. Error responses follow a consistent shape:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "request_id": "uuid"
  }
}
```

---

## Authentication

FraudScope uses two-token JWT authentication.

- **Access token** (15 min): returned in the response body, stored in memory by the frontend. Sent as `Authorization: Bearer <token>` on every protected request.
- **Refresh token** (7 days): stored in an `httpOnly` cookie. The frontend calls `POST /auth/refresh` automatically before the access token expires.

### POST /api/v1/auth/login

Authenticate with email and password. Returns an access token and sets the refresh token cookie.

**Auth required:** No

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `email` | string | Yes | User email address |
| `password` | string | Yes | User password |

**Request:**
```bash
curl -X POST http://localhost:3002/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "email": "analyst@fraudscope.dev",
    "password": "analyst123"
  }'
```

**Response `200 OK`:**
```json
{
  "user": {
    "id": "a1b2c3d4-...",
    "email": "analyst@fraudscope.dev",
    "first_name": "Test",
    "last_name": "Analyst",
    "role": "analyst"
  },
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

Sets cookie: `fraudscope_refresh_token=<token>; HttpOnly; SameSite=Lax`

**Errors:**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing or invalid fields |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password |

---

### POST /api/v1/auth/register

Create a new user account. Admin only.

**Auth required:** Yes (admin)

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `email` | string | Yes | New user email |
| `password` | string | Yes | Minimum 8 characters |
| `first_name` | string | Yes | First name |
| `last_name` | string | Yes | Last name |
| `role` | `analyst` \| `admin` | No | Defaults to `analyst` |

**Request:**
```bash
curl -X POST http://localhost:3002/api/v1/auth/register \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newanalyst@fraudscope.dev",
    "password": "securepass123",
    "first_name": "Sarah",
    "last_name": "Chen",
    "role": "analyst"
  }'
```

**Response `201 Created`:**
```json
{
  "user": {
    "id": "b2c3d4e5-...",
    "email": "newanalyst@fraudscope.dev",
    "first_name": "Sarah",
    "last_name": "Chen",
    "role": "analyst",
    "created_at": "2026-10-01T14:22:00.000Z"
  }
}
```

**Errors:**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid fields |
| 403 | `FORBIDDEN` | Non-admin caller |
| 409 | `CONFLICT` | Email already registered |

---

### POST /api/v1/auth/refresh

Issue a new access token using the refresh token cookie.

**Auth required:** No (uses `httpOnly` cookie)

**Request:**
```bash
curl -X POST http://localhost:3002/api/v1/auth/refresh \
  -b cookies.txt
```

**Response `200 OK`:**
```json
{
  "user": { "id": "...", "email": "...", "role": "analyst" },
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Errors:**

| Status | Code | When |
|---|---|---|
| 401 | `NO_REFRESH_TOKEN` | Cookie not present |
| 401 | `INVALID_REFRESH_TOKEN` | Expired or invalid cookie |

---

### POST /api/v1/auth/logout

Invalidate the session and clear the refresh token cookie.

**Auth required:** Yes

**Request:**
```bash
curl -X POST http://localhost:3002/api/v1/auth/logout \
  -H "Authorization: Bearer $TOKEN" \
  -b cookies.txt
```

**Response `200 OK`:**
```json
{ "message": "Logged out successfully" }
```

---

### GET /api/v1/auth/me

Return the authenticated user's profile.

**Auth required:** Yes

**Request:**
```bash
curl http://localhost:3002/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

**Response `200 OK`:**
```json
{
  "user": {
    "id": "a1b2c3d4-...",
    "email": "analyst@fraudscope.dev",
    "first_name": "Test",
    "last_name": "Analyst",
    "role": "analyst",
    "created_at": "2026-09-01T00:00:00.000Z",
    "last_login_at": "2026-10-11T14:22:00.000Z"
  }
}
```

---

## Transactions

### POST /api/v1/transactions

Ingest a transaction from an external system. Uses API key authentication (not JWT). After insertion, the transaction is published to the Redis Stream where the rule engine worker picks it up within milliseconds.

**Auth required:** `x-api-key` header

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `external_id` | string | Yes | Unique ID from the source system |
| `account_id` | string | Yes | Account identifier |
| `amount` | number | Yes | Transaction amount (positive) |
| `currency` | string | Yes | ISO 4217 currency code (e.g. `CAD`) |
| `country_code` | string | Yes | ISO 3166-1 alpha-2 country (e.g. `CA`) |
| `merchant_name` | string | No | Merchant or payee name |
| `merchant_category` | string | No | MCC description |
| `channel` | string | No | `card` \| `online` \| `atm` \| `wire` |
| `ip_address` | string | No | Client IP address |
| `latitude` | number | No | Geolocation latitude |
| `longitude` | number | No | Geolocation longitude |

**Request:**
```bash
curl -X POST http://localhost:3002/api/v1/transactions \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "external_id": "TX-2026-001",
    "account_id": "ACC-8812-X",
    "amount": 14250.00,
    "currency": "CAD",
    "country_code": "SC",
    "merchant_name": "CRYPTO-EXCHANGE-GLOBAL",
    "channel": "online",
    "ip_address": "185.197.56.211",
    "latitude": -4.6796,
    "longitude": 55.4920
  }'
```

**Response `201 Created`:**
```json
{
  "transaction": {
    "id": "c3d4e5f6-...",
    "external_id": "TX-2026-001",
    "account_id": "ACC-8812-X",
    "amount": "14250.00",
    "currency": "CAD",
    "status": "clean",
    "created_at": "2026-10-11T14:22:01.034Z"
  }
}
```

Note: `status` is always `clean` on creation. The rule engine updates it to `flagged` asynchronously if fraud rules trigger.

**Errors:**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing required fields |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 409 | `CONFLICT` | Duplicate `external_id` |

---

### GET /api/v1/transactions

List transactions with optional filters and pagination.

**Auth required:** Yes (analyst or admin)

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `status` | `clean` \| `flagged` \| `blocked` | all | Filter by status |
| `account_id` | string | -- | Filter by account |
| `sort` | string | `created_at:desc` | Format: `field:direction` |
| `limit` | number | `25` | Max 100 |
| `page` | number | `1` | Page number |

**Request:**
```bash
curl "http://localhost:3002/api/v1/transactions?status=flagged&limit=10&page=1" \
  -H "Authorization: Bearer $TOKEN"
```

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "c3d4e5f6-...",
      "external_id": "TX-2026-001",
      "account_id": "ACC-8812-X",
      "amount": "14250.00",
      "currency": "CAD",
      "merchant_name": "CRYPTO-EXCHANGE-GLOBAL",
      "country_code": "SC",
      "status": "flagged",
      "created_at": "2026-10-11T14:22:01.034Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 156,
    "pages": 16
  }
}
```

---

### GET /api/v1/transactions/:id

Full transaction detail including related alerts and account history (last 10 transactions for the same account).

**Auth required:** Yes (analyst or admin)

**Request:**
```bash
curl http://localhost:3002/api/v1/transactions/c3d4e5f6-... \
  -H "Authorization: Bearer $TOKEN"
```

**Response `200 OK`:**
```json
{
  "id": "c3d4e5f6-...",
  "external_id": "TX-2026-001",
  "account_id": "ACC-8812-X",
  "amount": "14250.00",
  "currency": "CAD",
  "merchant_name": "CRYPTO-EXCHANGE-GLOBAL",
  "country_code": "SC",
  "ip_address": "185.197.56.211",
  "latitude": -4.6796,
  "longitude": 55.4920,
  "status": "flagged",
  "created_at": "2026-10-11T14:22:01.034Z",
  "alerts": [
    {
      "id": "d4e5f6g7-...",
      "risk_score": 88,
      "severity": "critical",
      "status": "new",
      "triggered_rules": [
        {
          "ruleId": "...",
          "ruleName": "Geo Mismatch",
          "ruleType": "geo_mismatch",
          "score_contribution": 25,
          "details": { "current_country": "SC", "known_countries": ["CA", "US"] }
        }
      ],
      "created_at": "2026-10-11T14:22:01.500Z"
    }
  ],
  "account_history": [
    {
      "id": "...",
      "external_id": "TX-2026-000",
      "amount": "8.50",
      "currency": "CAD",
      "merchant_name": "Starbucks",
      "country_code": "CA",
      "status": "clean",
      "created_at": "2026-10-11T13:45:00.000Z"
    }
  ]
}
```

**Errors:**

| Status | Code | When |
|---|---|---|
| 404 | `NOT_FOUND` | Transaction does not exist |

---

## Alerts

### GET /api/v1/alerts

List alerts with filters and pagination. Includes nested transaction data and triggered rules.

**Auth required:** Yes (analyst or admin)

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `status` | string | all | Comma-separated: `new,reviewing,investigating` |
| `severity` | string | all | Comma-separated: `critical,high,medium,low` |
| `sort` | string | `risk_score:desc` | `risk_score:asc/desc` or `created_at:asc/desc` |
| `limit` | number | `25` | Max 100 |
| `page` | number | `1` | Page number |

**Request:**
```bash
curl "http://localhost:3002/api/v1/alerts?status=new,reviewing&sort=risk_score:desc&limit=25" \
  -H "Authorization: Bearer $TOKEN"
```

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "d4e5f6g7-...",
      "transaction_id": "c3d4e5f6-...",
      "risk_score": 88,
      "severity": "critical",
      "status": "new",
      "created_at": "2026-10-11T14:22:01.500Z",
      "resolved_at": null,
      "transaction": {
        "id": "c3d4e5f6-...",
        "external_id": "TX-2026-001",
        "account_id": "ACC-8812-X",
        "amount": "14250.00",
        "currency": "CAD",
        "merchant_name": "CRYPTO-EXCHANGE-GLOBAL",
        "country_code": "SC"
      },
      "triggered_rules": [
        {
          "ruleId": "...",
          "ruleName": "Geo Mismatch",
          "ruleType": "geo_mismatch",
          "score_contribution": 25
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 803,
    "pages": 33
  }
}
```

---

### GET /api/v1/alerts/counts

Returns counts grouped by status. Used for the sidebar notification badge.

**Auth required:** Yes (analyst or admin)

**Request:**
```bash
curl http://localhost:3002/api/v1/alerts/counts \
  -H "Authorization: Bearer $TOKEN"
```

**Response `200 OK`:**
```json
{
  "counts": {
    "new": 803,
    "reviewing": 2,
    "investigating": 0,
    "dismissed": 45,
    "escalated": 12,
    "pending": 805,
    "resolved": 57,
    "total": 862
  }
}
```

---

### GET /api/v1/alerts/:id

Full alert detail with triggered rules (including rule metadata and details JSON) and complete action history.

**Auth required:** Yes (analyst or admin)

**Request:**
```bash
curl http://localhost:3002/api/v1/alerts/d4e5f6g7-... \
  -H "Authorization: Bearer $TOKEN"
```

**Response `200 OK`:**
```json
{
  "alert": {
    "id": "d4e5f6g7-...",
    "transaction_id": "c3d4e5f6-...",
    "risk_score": 88,
    "severity": "critical",
    "status": "reviewing",
    "created_at": "2026-10-11T14:22:01.500Z",
    "resolved_at": null,
    "transaction": {
      "external_id": "TX-2026-001",
      "account_id": "ACC-8812-X",
      "amount": "14250.00",
      "currency": "CAD",
      "merchant_name": "CRYPTO-EXCHANGE-GLOBAL",
      "country_code": "SC",
      "ip_address": "185.197.56.211",
      "latitude": -4.6796,
      "longitude": 55.4920
    },
    "triggered_rules": [
      {
        "ruleId": "r1-...",
        "ruleName": "Geo Mismatch",
        "ruleType": "geo_mismatch",
        "ruleSeverity": "high",
        "score_contribution": 25,
        "details": {
          "rule_type": "geo_mismatch",
          "current_country": "SC",
          "known_countries": ["CA", "US", "GB"]
        }
      },
      {
        "ruleId": "r2-...",
        "ruleName": "High Velocity Check",
        "ruleType": "velocity",
        "score_contribution": 25,
        "details": {
          "rule_type": "velocity",
          "current_count": 8,
          "threshold": 5,
          "window_minutes": 10
        }
      }
    ],
    "actions": [
      {
        "id": "e5f6g7h8-...",
        "action": "investigate",
        "reason": "Impossible travel speed detected. IP from Seychelles 42 min after London transaction.",
        "previous_status": "new",
        "new_status": "reviewing",
        "created_at": "2026-10-11T14:25:40.000Z",
        "analyst": {
          "id": "a1b2c3d4-...",
          "email": "analyst@fraudscope.dev",
          "first_name": "Test",
          "last_name": "Analyst"
        }
      }
    ]
  }
}
```

---

### POST /api/v1/alerts/:id/actions

Take an action on an alert. Validates the action against the current status (state machine), writes to `alert_actions` and `audit_logs` atomically, then publishes to Redis PubSub so other analysts see the update in real time.

**Auth required:** Yes (analyst or admin)

**State machine:**

| Current status | Allowed actions |
|---|---|
| `new` | `dismiss`, `escalate`, `investigate`, `comment` |
| `reviewing` | `dismiss`, `escalate`, `investigate`, `comment`, `reassign` |
| `investigating` | `dismiss`, `escalate`, `comment`, `reassign` |
| `dismissed` | none (terminal) |
| `escalated` | none (terminal) |

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | `dismiss` \| `escalate` \| `investigate` \| `reassign` \| `comment` | Yes | Action to take |
| `reason` | string | Yes | Minimum 10 characters |

**Request:**
```bash
curl -X POST http://localhost:3002/api/v1/alerts/d4e5f6g7-.../actions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "escalate",
    "reason": "Confirmed fraud — customer reported unauthorized transaction. Card skimming suspected."
  }'
```

**Response `200 OK`:** Returns the full updated alert (same shape as `GET /alerts/:id`).

**Errors:**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid action type or reason too short |
| 404 | `NOT_FOUND` | Alert does not exist |
| 422 | `INVALID_TRANSITION` | Action not allowed from current status |

---

## Detection Rules

### GET /api/v1/rules

List all detection rules. Includes 7-day hit count per rule.

**Auth required:** Yes (analyst or admin)

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| `type` | string | Filter by rule type |
| `severity` | string | Filter by severity |
| `is_active` | boolean | Filter by active status |

**Request:**
```bash
curl "http://localhost:3002/api/v1/rules?is_active=true" \
  -H "Authorization: Bearer $TOKEN"
```

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "r1-...",
      "name": "High Velocity Check",
      "description": "Flags accounts with too many transactions in a short window",
      "type": "velocity",
      "parameters": { "max_count": 5, "window_minutes": 10 },
      "severity": "high",
      "score_weight": 25,
      "is_active": true,
      "created_at": "2026-09-01T00:00:00.000Z",
      "hit_count_7d": 142
    }
  ],
  "total": 5
}
```

---

### GET /api/v1/rules/:id

Single rule with full stats: trigger count, false positive rate, average score contribution, and last triggered timestamp.

**Auth required:** Yes (analyst or admin)

**Request:**
```bash
curl http://localhost:3002/api/v1/rules/r1-... \
  -H "Authorization: Bearer $TOKEN"
```

**Response `200 OK`:**
```json
{
  "rule": {
    "id": "r1-...",
    "name": "High Velocity Check",
    "type": "velocity",
    "parameters": { "max_count": 5, "window_minutes": 10 },
    "severity": "high",
    "score_weight": 25,
    "is_active": true,
    "stats": {
      "trigger_count": 891,
      "false_positive_rate": 0.12,
      "avg_score": 72.4,
      "last_triggered": "2026-10-11T14:22:01.500Z"
    }
  }
}
```

---

### POST /api/v1/rules

Create a new detection rule. Parameters are validated against the specific rule type's schema.

**Auth required:** Yes (admin)

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Max 100 characters |
| `description` | string | No | Max 500 characters |
| `type` | `velocity` \| `amount_anomaly` \| `geo_mismatch` \| `time_anomaly` \| `round_amount` | Yes | Rule type |
| `parameters` | object | Yes | Type-specific parameters (see below) |
| `severity` | `low` \| `medium` \| `high` \| `critical` | Yes | |
| `score_weight` | number | No | 5-40, default 20 |
| `is_active` | boolean | No | Default `true` |

**Parameters by rule type:**

`velocity`: `{ max_count: number(1-100), window_minutes: number(1-1440) }`

`amount_anomaly`: `{ multiplier: number(1.5-20), min_amount: number }`

`geo_mismatch`: `{ lookback_count: number(3-20), alert_on_new_country: boolean }`

`time_anomaly`: `{ suspicious_start_hour: number(0-23), suspicious_end_hour: number(0-23), timezone: string }`

`round_amount`: `{ min_amount: number, tolerance: number(0-5) }`

**Request:**
```bash
curl -X POST http://localhost:3002/api/v1/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Overnight Transaction Check",
    "type": "time_anomaly",
    "parameters": {
      "suspicious_start_hour": 2,
      "suspicious_end_hour": 5,
      "timezone": "America/Toronto"
    },
    "severity": "medium",
    "score_weight": 15,
    "is_active": true
  }'
```

**Response `201 Created`:**
```json
{
  "rule": {
    "id": "r6-...",
    "name": "Overnight Transaction Check",
    "type": "time_anomaly",
    "parameters": { "suspicious_start_hour": 2, "suspicious_end_hour": 5, "timezone": "America/Toronto" },
    "severity": "medium",
    "score_weight": 15,
    "is_active": true,
    "created_at": "2026-10-11T14:30:00.000Z"
  }
}
```

---

### PUT /api/v1/rules/:id

Full update of an existing rule. Re-validates parameters against the (potentially changed) rule type.

**Auth required:** Yes (admin)

Same request body as `POST /api/v1/rules`. Returns the updated rule.

---

### PATCH /api/v1/rules/:id/toggle

Flip the `is_active` flag. Immediately invalidates the rule cache so the change takes effect within seconds (without waiting for the 60-second TTL).

**Auth required:** Yes (admin)

**Request body:**

| Field | Type | Required |
|---|---|---|
| `is_active` | boolean | Yes |

**Request:**
```bash
curl -X PATCH http://localhost:3002/api/v1/rules/r1-.../toggle \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "is_active": false }'
```

**Response `200 OK`:** Returns the updated rule.

---

### DELETE /api/v1/rules/:id

Delete a rule. Refused if the rule has generated 10 or more alerts (to prevent orphaning alert history). Deactivate instead.

**Auth required:** Yes (admin)

**Request:**
```bash
curl -X DELETE http://localhost:3002/api/v1/rules/r1-... \
  -H "Authorization: Bearer $TOKEN"
```

**Response `200 OK`:**
```json
{ "deleted": true, "message": "Rule deleted successfully" }
```

**Errors:**

| Status | Code | When |
|---|---|---|
| 404 | `NOT_FOUND` | Rule does not exist |
| 409 | `CONFLICT` | Rule has 10+ associated alerts |

---

## Analytics

All analytics endpoints accept the same date range parameters:

| Param | Type | Default | Description |
|---|---|---|---|
| `from` | ISO 8601 datetime | 7 days ago | Start of range |
| `to` | ISO 8601 datetime | now | End of range |
| `bust` | `true` | -- | Bypass Redis cache for this request |

Responses include `X-Cache: HIT` or `X-Cache: MISS` header. Results are cached for 5 minutes by default (configurable via `ANALYTICS_CACHE_TTL`).

---

### GET /api/v1/analytics/overview

Four metric cards: transaction count, alert count, pending review count, and average response time. Each includes a trend percentage vs the equivalent previous period.

**Auth required:** Yes (analyst or admin)

**Request:**
```bash
curl "http://localhost:3002/api/v1/analytics/overview?from=2026-10-01T00:00:00Z&to=2026-10-11T00:00:00Z" \
  -H "Authorization: Bearer $TOKEN"
```

**Response `200 OK`:**
```json
{
  "period": {
    "from": "2026-10-01T00:00:00.000Z",
    "to": "2026-10-11T00:00:00.000Z"
  },
  "metrics": {
    "transactions": {
      "value": 12847,
      "formatted": "12,847",
      "trend": 12,
      "previous": 11470,
      "label": "Transactions"
    },
    "alerts": {
      "value": 23,
      "formatted": "23",
      "trend": -8,
      "previous": 25,
      "label": "Alerts Generated"
    },
    "pending": {
      "value": 8,
      "formatted": "8",
      "trend": 0,
      "previous": null,
      "label": "Pending Review"
    },
    "avg_response_time": {
      "value": 272,
      "formatted": "4m 32s",
      "trend": 12,
      "previous": "5m 8s",
      "label": "Avg Response Time"
    }
  }
}
```

---

### GET /api/v1/analytics/alert-volume

Time series of alert counts grouped by severity. Used for the AreaChart. Automatically switches between hourly grouping (ranges under 48h) and daily grouping (longer ranges).

**Auth required:** Yes (analyst or admin)

**Response `200 OK`:**
```json
{
  "group_by": "day",
  "data": [
    {
      "period": "2026-10-01",
      "low": 2,
      "medium": 5,
      "high": 3,
      "critical": 1,
      "total": 11
    },
    {
      "period": "2026-10-02",
      "low": 0,
      "medium": 3,
      "high": 4,
      "critical": 2,
      "total": 9
    }
  ]
}
```

---

### GET /api/v1/analytics/severity

Alert count and percentage per severity level for the donut chart.

**Auth required:** Yes (analyst or admin)

**Response `200 OK`:**
```json
{
  "total": 23,
  "data": [
    { "severity": "critical", "count": 6,  "percentage": 26, "color": "#ef4444" },
    { "severity": "high",     "count": 8,  "percentage": 35, "color": "#f97316" },
    { "severity": "medium",   "count": 9,  "percentage": 39, "color": "#f59e0b" },
    { "severity": "low",      "count": 0,  "percentage": 0,  "color": "#60a5fa" }
  ]
}
```

---

### GET /api/v1/analytics/rule-effectiveness

Per-rule trigger counts with true positive and false positive rates. Used for the horizontal bar chart and sortable table.

**Auth required:** Yes (analyst or admin)

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "r1-...",
      "name": "High Velocity Check",
      "type": "velocity",
      "severity": "high",
      "is_active": true,
      "trigger_count": 142,
      "true_positives": 28,
      "false_positives": 17,
      "tp_rate": 20,
      "fp_rate": 12,
      "avg_contribution": 24.5,
      "trend": 15,
      "prev_count": 124
    }
  ]
}
```

---

### GET /api/v1/analytics/resolution

Time series of analyst actions (dismiss, escalate, investigate) plus summary stats.

**Auth required:** Yes (analyst or admin)

**Response `200 OK`:**
```json
{
  "group_by": "day",
  "data": [
    {
      "period": "2026-10-01",
      "dismiss": 4,
      "escalate": 2,
      "investigate": 3,
      "total": 9
    }
  ],
  "summary": {
    "total_resolved": 45,
    "resolution_rate": 78,
    "total_dismissed": 33,
    "total_escalated": 12,
    "total_investigated": 8,
    "avg_time_dismiss": "4m 12s",
    "avg_time_escalate": "8m 55s",
    "avg_time_investigate": "22m 30s"
  }
}
```

---

### GET /api/v1/analytics/analyst-performance

Per-analyst alert review metrics. Returns only analysts who took at least one action in the selected period.

**Auth required:** Yes (analyst or admin)

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "a1b2c3d4-...",
      "email": "analyst@fraudscope.dev",
      "first_name": "Test",
      "last_name": "Analyst",
      "role": "analyst",
      "total_reviewed": 38,
      "dismissed": 24,
      "escalated": 8,
      "investigated": 6,
      "avg_response_seconds": 272,
      "avg_response_formatted": "4m 32s",
      "escalation_rate": 21,
      "fp_rate": 63
    }
  ]
}
```

---

### GET /api/v1/analytics/top-accounts

Accounts with the most fraud alerts, useful for identifying repeat offenders.

**Auth required:** Yes (analyst or admin)

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `10` | Max 50 |

**Response `200 OK`:**
```json
{
  "data": [
    {
      "account_id": "ACC-8812-X",
      "alert_count": 12,
      "total_volume": 189420.50,
      "max_risk_score": 98,
      "avg_risk_score": 76,
      "critical_count": 4,
      "high_count": 5
    }
  ]
}
```

---

### POST /api/v1/analytics/cache/bust

Clear all analytics cache entries in Redis. Useful after a data import or rule change when you want the next dashboard load to reflect fresh data.

**Auth required:** Yes (admin)

**Request:**
```bash
curl -X POST http://localhost:3002/api/v1/analytics/cache/bust \
  -H "Authorization: Bearer $TOKEN"
```

**Response `200 OK`:**
```json
{
  "message": "Cleared 14 analytics cache entries",
  "deleted": 14
}
```

---

## Users (Admin)

### GET /api/v1/users

List all users.

**Auth required:** Yes (admin)

**Response `200 OK`:**
```json
{
  "users": [
    {
      "id": "a1b2c3d4-...",
      "email": "analyst@fraudscope.dev",
      "first_name": "Test",
      "last_name": "Analyst",
      "role": "analyst",
      "is_active": true,
      "last_login_at": "2026-10-11T14:22:00.000Z",
      "created_at": "2026-09-01T00:00:00.000Z"
    }
  ]
}
```

---

### PATCH /api/v1/users/:id

Update a user's role or active status. Deactivating a user revokes dashboard access immediately but preserves all audit history.

**Auth required:** Yes (admin)

**Request body:**

| Field | Type | Description |
|---|---|---|
| `role` | `analyst` \| `admin` | New role |
| `is_active` | boolean | Activate or deactivate account |

**Request:**
```bash
curl -X PATCH http://localhost:3002/api/v1/users/a1b2c3d4-... \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "is_active": false }'
```

**Response `200 OK`:**
```json
{
  "user": {
    "id": "a1b2c3d4-...",
    "email": "analyst@fraudscope.dev",
    "role": "analyst",
    "is_active": false
  }
}
```

---

## Audit Logs

### GET /api/v1/audit-logs

Paginated audit log with filters. All state-changing operations write an audit entry: alert actions, rule changes, user registrations, logins, and logouts.

**Auth required:** Yes (admin)

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| `search` | string | Search `event_type` or `target_id` (debounced client-side) |
| `event_type` | string | Exact match on event type e.g. `alert.escalate` |
| `category` | string | Prefix match: `alert`, `rule`, `user`, `transaction` |
| `actor_id` | string | Filter by user ID or `system` for engine events |
| `from` | ISO 8601 | Start of date range |
| `to` | ISO 8601 | End of date range |
| `page` | number | Default `1` |
| `limit` | number | Default `50`, max 100 |

**Request:**
```bash
curl "http://localhost:3002/api/v1/audit-logs?category=alert&from=2026-10-01T00:00:00Z&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "f6g7h8i9-...",
      "event_type": "alert.escalate",
      "actor_type": "user",
      "actor_id": "a1b2c3d4-...",
      "actor": {
        "id": "a1b2c3d4-...",
        "email": "analyst@fraudscope.dev",
        "first_name": "Test",
        "last_name": "Analyst"
      },
      "target_type": "alert",
      "target_id": "d4e5f6g7-...",
      "payload": {
        "action": "escalate",
        "reason": "Confirmed fraud",
        "previous_status": "new",
        "new_status": "escalated"
      },
      "created_at": "2026-10-11T14:25:40.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 4291,
    "pages": 215
  }
}
```

---

### GET /api/v1/audit-logs/export

Download all matching audit logs as a CSV file. Applies the same filters as `GET /api/v1/audit-logs`. Returns up to 10,000 rows.

**Auth required:** Yes (admin)

**Request:**
```bash
curl "http://localhost:3002/api/v1/audit-logs/export?from=2026-10-01T00:00:00Z" \
  -H "Authorization: Bearer $TOKEN" \
  -o audit-export.csv
```

**Response:** `text/csv` file download with headers:
`timestamp, event_type, actor, target_type, target_id, details`

---

## Health

### GET /health

Basic liveness check. No authentication required. Used by load balancers and Docker healthchecks.

**Request:**
```bash
curl http://localhost:3002/health
```

**Response `200 OK`:**
```json
{
  "status": "ok",
  "service": "fraudscope-api",
  "timestamp": "2026-10-11T14:22:00.000Z"
}
```

---

### GET /api/v1/health/detailed

Detailed service health for each dependency. Returns `200` when all services are healthy, `503` when any service is degraded.

**Auth required:** Yes (admin)

**Request:**
```bash
curl http://localhost:3002/api/v1/health/detailed \
  -H "Authorization: Bearer $TOKEN"
```

**Response `200 OK` (all healthy):**
```json
{
  "status": "healthy",
  "uptime_seconds": 86400,
  "uptime_human": "1d 0h 0m 0s",
  "timestamp": "2026-10-11T14:22:00.000Z",
  "services": {
    "api":      { "name": "API Server",    "status": "healthy", "latency_ms": 0,  "message": "Running" },
    "postgres": { "name": "PostgreSQL",    "status": "healthy", "latency_ms": 2,  "message": "Connected — 12,847 transactions" },
    "redis":    { "name": "Redis",         "status": "healthy", "latency_ms": 1,  "message": "Connected — v7.2.3" },
    "worker":   { "name": "Engine Worker", "status": "healthy", "latency_ms": 0,  "message": "1 consumer — 0 pending" }
  },
  "metrics": {
    "queue_depth": 0,
    "tx_per_minute": 45
  }
}
```

**Response `503 Service Unavailable` (degraded):** Same shape with `"status": "degraded"` and affected services showing `"status": "unhealthy"`.

---

## WebSocket Events

Connect to `ws://localhost:3002` using Socket.io. Pass the JWT access token in the handshake:

```javascript
const socket = io('http://localhost:3002', {
  auth: { token: accessToken }
});

// Join rooms
socket.emit('subscribe', { channels: ['tx:live', 'alerts'] });
```

### Server-to-client events

| Event | Room | Payload |
|---|---|---|
| `tx:new` | `tx:live` | New transaction object |
| `alert:new` | `alerts` | New alert with triggered rules |
| `alert:updated` | `alerts` | Status change from analyst action |
| `system:connected` | (self) | Connection confirmation with user info |
| `system:status` | (all) | Active connections and analyst count every 10s |

### Client-to-server events

| Event | Payload | Description |
|---|---|---|
| `subscribe` | `{ channels: string[] }` | Join rooms (`tx:live`, `alerts`) |
| `unsubscribe` | `{ channels: string[] }` | Leave rooms |
| `alert:claim` | `{ alert_id: string }` | Mark alert as `reviewing`, broadcast to other analysts |