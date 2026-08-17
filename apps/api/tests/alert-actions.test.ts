// apps/api/tests/alert-actions.test.ts
// Integration tests for the alerts API — FS-25

import request from 'supertest';
import {
  createTestDb,
  runMigrations,
  clearDatabase,
  closeConnections,
} from './helpers/testSetup';
import { getTestTokens, SEEDED_ANALYST_ID, SEEDED_ADMIN_ID } from './helpers/testAuth';
import { createTestApp } from './helpers/testApp';
import { Knex } from 'knex';

const app = createTestApp();
let db: Knex;
let ANALYST_TOKEN: string;
let ADMIN_TOKEN: string;

// Use the shared seeded user IDs (from testAuth.ts)
const ANALYST_ID = SEEDED_ANALYST_ID;
const ADMIN_ID   = SEEDED_ADMIN_ID;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  db = createTestDb();
  await runMigrations(db);

  const tokens = await getTestTokens(db);
  ANALYST_TOKEN = tokens.ANALYST_TOKEN;
  ADMIN_TOKEN   = tokens.ADMIN_TOKEN;
});

beforeEach(async () => {
  await clearDatabase(db);
});

afterAll(async () => {
  await closeConnections(db);
});

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
async function seedTransaction(overrides: Record<string, unknown> = {}) {
  const [tx] = await db('transactions').insert({
    external_id: `TEST-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    account_id:  'ACC-0001',
    amount:      5000,
    currency:    'CAD',
    country_code: 'CA',
    status:      'flagged',
    ...overrides,
  }).returning('*');
  return tx;
}

async function seedAlert(overrides: Record<string, unknown> = {}) {
  const tx = await seedTransaction();
  const [alert] = await db('alerts').insert({
    transaction_id: tx.id,
    risk_score:     75,
    severity:       'high',
    status:         'new',
    ...overrides,
  }).returning('*');
  return { alert, tx };
}

async function seedRule() {
  const [rule] = await db('rules').insert({
    name:       'Test Rule',
    type:       'velocity',
    parameters: JSON.stringify({ max_count: 5, window_minutes: 10 }),
    severity:   'high',
    score_weight: 25,
    is_active:  true,
  }).returning('*');
  return rule;
}

// ─────────────────────────────────────────
// GET /api/v1/alerts
// ─────────────────────────────────────────
describe('GET /api/v1/alerts', () => {

  test('returns 200 with data and pagination', async () => {
    await seedAlert();
    await seedAlert();

    const res = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination).toMatchObject({
      page: 1,
      limit: 25,
      total: 2,
    });
  });

  test('filters by status', async () => {
    await seedAlert({ status: 'new' });
    await seedAlert({ status: 'dismissed' });

    const res = await request(app)
      .get('/api/v1/alerts?status=new')
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].status).toBe('new');
  });

  test('filters by multiple statuses (comma-separated)', async () => {
    await seedAlert({ status: 'new' });
    await seedAlert({ status: 'reviewing' });
    await seedAlert({ status: 'dismissed' });

    const res = await request(app)
      .get('/api/v1/alerts?status=new,reviewing')
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    res.body.data.forEach((a: any) => {
      expect(['new', 'reviewing']).toContain(a.status);
    });
  });

  test('requires authentication → 401', async () => {
    const res = await request(app).get('/api/v1/alerts');
    expect(res.status).toBe(401);
  });

  test('response includes triggered_rules array', async () => {
    const { alert } = await seedAlert();
    const rule = await seedRule();
    await db('alert_rules').insert({
      alert_id:          alert.id,
      rule_id:           rule.id,
      score_contribution: 25,
      details:           JSON.stringify({ rule_type: 'velocity', current_count: 6 }),
    });

    const res = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].triggered_rules).toBeDefined();
    expect(Array.isArray(res.body.data[0].triggered_rules)).toBe(true);
  });
});

// ─────────────────────────────────────────
// GET /api/v1/alerts/counts
// ─────────────────────────────────────────
describe('GET /api/v1/alerts/counts', () => {

  test('returns counts by status with totals', async () => {
    await seedAlert({ status: 'new' });
    await seedAlert({ status: 'new' });
    await seedAlert({ status: 'reviewing' });
    await seedAlert({ status: 'dismissed' });

    const res = await request(app)
      .get('/api/v1/alerts/counts')
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({
      new:       2,
      reviewing: 1,
      dismissed: 1,
      escalated: 0,
      pending:   3, // new + reviewing + investigating
      resolved:  1, // dismissed + escalated
      total:     4,
    });
  });

  test('returns zeros when no alerts', async () => {
    const res = await request(app)
      .get('/api/v1/alerts/counts')
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.counts.total).toBe(0);
    expect(res.body.counts.pending).toBe(0);
  });
});

// ─────────────────────────────────────────
// GET /api/v1/alerts/:id
// ─────────────────────────────────────────
describe('GET /api/v1/alerts/:id', () => {

  test('returns full alert detail with transaction', async () => {
    const { alert, tx } = await seedAlert();

    const res = await request(app)
      .get(`/api/v1/alerts/${alert.id}`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.alert.id).toBe(alert.id);
    expect(res.body.alert.transaction).toBeDefined();
    expect(res.body.alert.transaction.id).toBe(tx.id);
    expect(res.body.alert.triggered_rules).toBeDefined();
    expect(res.body.alert.actions).toBeDefined();
  });

  test('returns 404 for non-existent alert', async () => {
    const res = await request(app)
      .get('/api/v1/alerts/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('returns triggered_rules with details', async () => {
    const { alert } = await seedAlert();
    const rule = await seedRule();
    await db('alert_rules').insert({
      alert_id:           alert.id,
      rule_id:            rule.id,
      score_contribution: 25,
      details:            JSON.stringify({
        rule_type: 'velocity',
        current_count: 8,
        threshold: 5,
        message: '8 transactions in 10 min',
      }),
    });

    const res = await request(app)
      .get(`/api/v1/alerts/${alert.id}`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(200);
    const rules = res.body.alert.triggered_rules;
    expect(rules.length).toBe(1);
    expect(rules[0].score_contribution).toBe(25);
    expect(rules[0].details.rule_type).toBe('velocity');
    expect(rules[0].ruleName).toBe('Test Rule');
  });
});

// ─────────────────────────────────────────
// POST /api/v1/alerts/:id/actions
// ─────────────────────────────────────────
describe('POST /api/v1/alerts/:id/actions', () => {

  // ── Happy paths ─────────────────────────────────────────────────

  test('dismiss a new alert → status becomes dismissed', async () => {
    const { alert } = await seedAlert({ status: 'new' });

    const res = await request(app)
      .post(`/api/v1/alerts/${alert.id}/actions`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send({ action: 'dismiss', reason: 'This is a false positive — known travel' });

    expect(res.status).toBe(200);
    expect(res.body.alert.status).toBe('dismissed');
    expect(res.body.alert.resolved_at).not.toBeNull();

    // Verify DB updated
    const updated = await db('alerts').where({ id: alert.id }).first();
    expect(updated.status).toBe('dismissed');
    expect(updated.resolved_at).not.toBeNull();
  });

  test('escalate a new alert → status becomes escalated', async () => {
    const { alert } = await seedAlert({ status: 'new' });

    const res = await request(app)
      .post(`/api/v1/alerts/${alert.id}/actions`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send({ action: 'escalate', reason: 'Confirmed fraud — customer reported unauthorized charge' });

    expect(res.status).toBe(200);
    expect(res.body.alert.status).toBe('escalated');
    expect(res.body.alert.resolved_at).not.toBeNull();
  });

  test('investigate a new alert → status becomes investigating', async () => {
    const { alert } = await seedAlert({ status: 'new' });

    const res = await request(app)
      .post(`/api/v1/alerts/${alert.id}/actions`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send({ action: 'investigate', reason: 'Needs further analysis — contacting account holder' });

    expect(res.status).toBe(200);
    expect(res.body.alert.status).toBe('investigating');
    // Non-terminal — resolved_at should be null
    expect(res.body.alert.resolved_at).toBeNull();
  });

  // ── State machine validation ─────────────────────────────────────

  test('cannot dismiss an already-escalated alert → 422', async () => {
    const { alert } = await seedAlert({ status: 'escalated' });

    const res = await request(app)
      .post(`/api/v1/alerts/${alert.id}/actions`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send({ action: 'dismiss', reason: 'Trying to dismiss an escalated alert' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect(res.body.error.message).toContain('escalated');
  });

  test('cannot escalate an already-dismissed alert → 422', async () => {
    const { alert } = await seedAlert({ status: 'dismissed' });

    const res = await request(app)
      .post(`/api/v1/alerts/${alert.id}/actions`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send({ action: 'escalate', reason: 'Trying to escalate a dismissed alert' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  test('cannot act on an already-dismissed alert → 422', async () => {
    const { alert } = await seedAlert({ status: 'dismissed' });

    const res = await request(app)
      .post(`/api/v1/alerts/${alert.id}/actions`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send({ action: 'investigate', reason: 'Trying to investigate a dismissed alert' });

    expect(res.status).toBe(422);
  });

  // ── Validation ───────────────────────────────────────────────────

  test('reason shorter than 10 chars → 400', async () => {
    const { alert } = await seedAlert();

    const res = await request(app)
      .post(`/api/v1/alerts/${alert.id}/actions`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send({ action: 'dismiss', reason: 'too short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const detail = res.body.error.details.find((d: any) => d.field === 'reason');
    expect(detail).toBeDefined();
    expect(detail.message).toContain('10');
  });

  test('invalid action type → 400', async () => {
    const { alert } = await seedAlert();

    const res = await request(app)
      .post(`/api/v1/alerts/${alert.id}/actions`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send({ action: 'delete', reason: 'This is a valid reason length' });

    expect(res.status).toBe(400);
  });

  test('non-existent alert → 404', async () => {
    const res = await request(app)
      .post('/api/v1/alerts/00000000-0000-0000-0000-000000000000/actions')
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send({ action: 'dismiss', reason: 'Trying to act on non-existent alert' });

    expect(res.status).toBe(404);
  });

  test('missing auth → 401', async () => {
    const { alert } = await seedAlert();

    const res = await request(app)
      .post(`/api/v1/alerts/${alert.id}/actions`)
      .send({ action: 'dismiss', reason: 'No auth header provided here' });

    expect(res.status).toBe(401);
  });

  // ── Audit trail ──────────────────────────────────────────────────

  test('action creates alert_actions record', async () => {
    const { alert } = await seedAlert({ status: 'new' });

    await request(app)
      .post(`/api/v1/alerts/${alert.id}/actions`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send({ action: 'dismiss', reason: 'False positive — verified with customer' });

    const action = await db('alert_actions')
      .where({ alert_id: alert.id })
      .first();

    expect(action).toBeDefined();
    expect(action.action).toBe('dismiss');
    expect(action.reason).toBe('False positive — verified with customer');
    expect(action.previous_status).toBe('new');
    expect(action.new_status).toBe('dismissed');
    expect(action.analyst_id).toBe(ANALYST_ID);
  });

  test('action creates audit_log entry', async () => {
    const { alert } = await seedAlert({ status: 'new' });

    await request(app)
      .post(`/api/v1/alerts/${alert.id}/actions`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send({ action: 'escalate', reason: 'Confirmed fraud — card skimming detected' });

    const log = await db('audit_logs')
      .where({ event_type: 'alert.escalate', target_id: alert.id })
      .first();

    expect(log).toBeDefined();
    expect(log.actor_id).toBe(ANALYST_ID);
    expect(log.source).toBe('api');

    const payload = typeof log.payload === 'string'
      ? JSON.parse(log.payload)
      : log.payload;
    expect(payload.action).toBe('escalate');
    expect(payload.previous_status).toBe('new');
    expect(payload.new_status).toBe('escalated');
  });

  test('action history appears in GET /:id response', async () => {
    const { alert } = await seedAlert({ status: 'new' });

    // Take an action
    await request(app)
      .post(`/api/v1/alerts/${alert.id}/actions`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send({ action: 'investigate', reason: 'Needs further analysis' });

    // Fetch the alert
    const res = await request(app)
      .get(`/api/v1/alerts/${alert.id}`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.alert.actions).toHaveLength(1);
    expect(res.body.alert.actions[0].action).toBe('investigate');
    expect(res.body.alert.actions[0].analyst.email).toBe('analyst@fraudscope.dev');
  });

  test('multiple actions accumulate in history', async () => {
    const { alert } = await seedAlert({ status: 'new' });

    // First action: investigate
    await request(app)
      .post(`/api/v1/alerts/${alert.id}/actions`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send({ action: 'investigate', reason: 'Needs further analysis — contacting customer' });

    // Second action: escalate (from investigating status)
    await request(app)
      .post(`/api/v1/alerts/${alert.id}/actions`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send({ action: 'escalate', reason: 'Customer confirmed — card was stolen last week' });

    const res = await request(app)
      .get(`/api/v1/alerts/${alert.id}`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.body.alert.actions).toHaveLength(2);
    expect(res.body.alert.actions[0].action).toBe('investigate');
    expect(res.body.alert.actions[1].action).toBe('escalate');
    expect(res.body.alert.status).toBe('escalated');
  });
});