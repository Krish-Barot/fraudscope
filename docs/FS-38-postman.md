# FS-38: FraudScope Postman API Test Collection

This document provides complete instructions for importing, configuring, and executing the comprehensive Postman API test collection for FraudScope.

---

## 1. Overview of Artifacts

The test suite consists of two core files and this documentation:

1. **Collection**: [`docs/fraudscope.postman_collection.json`](file:///Users/HP/Documents/Projects/FraudScope/fraudscope/docs/fraudscope.postman_collection.json)
   - Follows Postman Collection v2.1.0 schema.
   - Contains exactly **50 test scenarios** organized into 7 folders.
   - Every request includes automated assertions in the `Tests` tab.
2. **Environment**: [`docs/fraudscope.postman_environment.json`](file:///Users/HP/Documents/Projects/FraudScope/fraudscope/docs/fraudscope.postman_environment.json)
   - Follows Postman Environment schema.
   - Contains placeholder variables: `base_url`, `access_token`, `admin_token`, and `api_key`.
   - Never contains hardcoded secrets or production credentials.
3. **Documentation**: [`docs/FS-38-postman.md`](file:///Users/HP/Documents/Projects/FraudScope/fraudscope/docs/FS-38-postman.md)

---

## 2. Folder Structure and Request Counts

The collection contains exactly 50 requests distributed across seven folders:

| Folder | Request Count | Scope & Covered Endpoints |
|---|---|---|
| **Auth** | 8 | Login (`POST /api/v1/auth/login`), refresh token (`POST /api/v1/auth/refresh`), profile inspection (`GET /api/v1/auth/me`), logout (`POST /api/v1/auth/logout`), invalid credentials, missing fields, unauthorized access. |
| **Transactions** | 10 | Transaction ingestion (`POST /api/v1/transactions`), pagination & filtering (`GET /api/v1/transactions`), detail retrieval (`GET /api/v1/transactions/:id`), validation failures, API key authorization. |
| **Rule Engine** | 8 | Asynchronous evaluation pipeline, clean transaction scoring, rule-triggering scoring, status validation (`GET /api/v1/transactions/:id`), payload validation, unauthorized requests, active rules inspection (`GET /api/v1/rules`). |
| **Alerts** | 8 | Alert listing (`GET /api/v1/alerts`), severity & status filters, custom pagination, summary counts (`GET /api/v1/alerts/counts`), alert details (`GET /api/v1/alerts/:id`), action commentary (`POST /api/v1/alerts/:id/actions`), validation errors, missing auth. |
| **Analytics** | 6 | KPI overview (`GET /api/v1/analytics/overview`), alert volume trends (`GET /api/v1/analytics/alert-volume`), severity distribution (`GET /api/v1/analytics/severity`), rule effectiveness (`GET /api/v1/analytics/rule-effectiveness`), resolution metrics (`GET /api/v1/analytics/resolution`), top accounts (`GET /api/v1/analytics/top-accounts`). |
| **Admin Rules** | 6 | Rule creation (`POST /api/v1/rules`), analyst RBAC boundary check (403), parameter schema validation (400), full replacement update (`PUT /api/v1/rules/:id`), active status toggle (`PATCH /api/v1/rules/:id/toggle`), rule deletion cleanup (`DELETE /api/v1/rules/:id`). |
| **Admin Users** | 4 | User listing (`GET /api/v1/users`), analyst RBAC boundary check (403), user creation (`POST /api/v1/users`), user role promotion (`PATCH /api/v1/users/:id`). Password hashes are confirmed omitted. |
| **Total** | **50** | All requests verified against real Express controllers and Knex database queries. |

---

## 3. How to Import

### Postman Desktop App
1. Open Postman.
2. Click **File > Import** (or click the **Import** button in the top-left corner).
3. Drag and drop both files:
   - `docs/fraudscope.postman_collection.json`
   - `docs/fraudscope.postman_environment.json`
4. In the environment selector in the top-right corner, select **FraudScope Local Environment**.

---

## 4. Configuration and Environment Setup

The committed environment file contains safe placeholder values. Configure local values before executing:

### Required Variables

| Variable | Default Placeholder | Local Development Value | Description |
|---|---|---|---|
| `base_url` | `http://localhost:3002` | `http://localhost:3002` | Base HTTP URL for the running FraudScope API server. |
| `api_key` | `REPLACE_WITH_LOCAL_API_KEY` | `dev_api_key_fraudscope` | Machine-to-machine API key configured in `.env` (`API_KEY`). Required for `/api/v1/transactions`. |
| `access_token` | `""` | *(Auto-populated)* | Session token for human analyst endpoints. Automatically acquired by pre-request scripts. |
| `admin_token` | `""` | *(Auto-populated)* | Session token for administrator-only endpoints. Automatically acquired by pre-request scripts. |

### Optional Credential Overrides
If using custom test users instead of seed data, set these variables in Postman or via Newman command-line arguments:
- `analyst_email`: (Default: `analyst@fraudscope.dev`)
- `analyst_password`: (Default: `analyst123`)
- `admin_email`: (Default: `admin@fraudscope.dev`)
- `admin_password`: (Default: `admin123`)

---

## 5. Automatic Authentication Mechanism

The collection uses automated pre-request scripts to streamline authentication without manual token copying:

1. **Auth Folder Pre-Request Script**:
   - Executes before requests in the `Auth` folder.
   - Automatically calls `POST /api/v1/auth/login` using `pm.sendRequest` if no token is present.
   - Saves `access_token` and extracts `refresh_token_cookie` from the `Set-Cookie` header.
   - **Negative Test Bypass**: Inspects request names and temporary `X-Skip-Auto-Auth` headers to ensure negative tests (e.g., incorrect password, unknown email, unauthenticated access) run unmodified and are never blocked or polluted by auto-auth.
2. **Analyst Folders Pre-Request Script** (Transactions, Rule Engine, Alerts, Analytics):
   - Ensures an active `access_token` exists before dispatching analyst requests.
3. **Admin Folders Pre-Request Script** (Admin Rules, Admin Users):
   - Automatically logs in using the admin account (`admin@fraudscope.dev`) and stores the token in `admin_token`.
   - Admin mutation requests utilize `Authorization: Bearer {{admin_token}}`.
   - RBAC negative tests utilize `Authorization: Bearer {{access_token}}` to verify that `403 Forbidden` is returned when an analyst attempts admin actions.

---

## 6. Execution Instructions

### Option A: Running with Newman (CLI)

Ensure the FraudScope local development containers are running:
```bash
docker compose up -d
```

Run the complete 50-test collection with Newman:
```bash
npx -y newman run docs/fraudscope.postman_collection.json \
  -e docs/fraudscope.postman_environment.json \
  --env-var "api_key=dev_api_key_fraudscope"
```

### Option B: Running in Postman App Collection Runner
1. Select the **FraudScope API Test Collection** in the left sidebar.
2. Click **Run Collection**.
3. Ensure the environment is set to **FraudScope Local Environment**.
4. Set the `api_key` environment variable to `dev_api_key_fraudscope` (or your configured local key).
5. Click **Run FraudScope API Test Collection**.

---

## 7. Execution Order, Seed Data, and Cleanup

- **Deterministic Ordering**: The folders are ordered sequentially (Auth → Transactions → Rule Engine → Alerts → Analytics → Admin Rules → Admin Users).
- **Dynamic Resource IDs**:
  - `Ingest Transaction` saves `test_transaction_id` for detail retrieval tests.
  - `Evaluate Transaction` captures `rule_eval_clean_tx_id` and `rule_eval_flagged_tx_id` for status verification.
  - `List Alerts` and `Rule Engine` dynamically capture `test_alert_id` for action tests.
  - `Create Rule` saves `created_rule_id`, which is subsequently tested via `PUT`, `PATCH /toggle`, and deleted cleanly via `DELETE`.
  - `Create User` saves `created_user_id`, which is updated and role-promoted via `PATCH`.
- **Zero Polluting Residuals**: Test rules created during the test run are deleted in the cleanup scenario (`Admin Rules / Delete Rule - Admin Cleanup`).

---

## 8. Validation Results

Execution validated locally via Newman against the live FraudScope development environment:

```
┌─────────────────────────┬──────────────────┬──────────────────┐
│                         │         executed │           failed │
├─────────────────────────┼──────────────────┼──────────────────┤
│              iterations │                1 │                0 │
├─────────────────────────┼──────────────────┼──────────────────┤
│                requests │               53 │                0 │
├─────────────────────────┼──────────────────┼──────────────────┤
│            test-scripts │               50 │                0 │
├─────────────────────────┼──────────────────┼──────────────────┤
│      prerequest-scripts │               56 │                0 │
├─────────────────────────┼──────────────────┼──────────────────┤
│              assertions │              101 │                0 │
└─────────────────────────┴──────────────────┴──────────────────┘
Total run duration: ~3.9s
Failed assertions: 0 (100% pass rate)
```

### Known Implementation Nuances
- **Asynchronous Scoring**: Transaction evaluation occurs asynchronously via the Redis worker. The `Rule Engine` status verification requests include short bounded pauses (1.2–1.5s) to allow asynchronous worker scoring before verifying `status` and `alerts`.
- **Pagination Structure**: Both transactions and alerts return pagination metadata under `res.body.pagination` (`page`, `limit`, `total`, `pages`).
- **Counts Endpoint**: `GET /api/v1/alerts/counts` returns a flat object under `counts` with status counts (`new`, `reviewing`, `investigating`, `dismissed`, `escalated`, `pending`, `resolved`, `total`).
- **Rule Effectiveness**: The rule performance endpoint returns `fp_rate` for false positive rates.
