// apps/api/tests/rules.test.ts
// Integration tests for the Rules API — FS-18 required
//
// Tests make real HTTP requests to the Express app
// against the test database (postgres_test on port 5433)
//
// Required tests (FS-18):
// 1. Create rule as admin → 201
// 2. Create rule as analyst → 403
// 3. Toggle rule flips is_active
// 4. Get rule stats returns trigger_count
// 5. Delete rule with > 10 alerts → 409

import request from 'supertest';
import {
  createTestDb,
  runMigrations,
  clearDatabase,
  closeConnections,
} from './helpers/testSetup';
import { createTestApp } from './helpers/testApp';
import { getTestTokens } from './helpers/testAuth';
import { Knex } from 'knex';

// ─────────────────────────────────────────
// Setup
// ─────────────────────────────────────────
const app = createTestApp();
let db: Knex;
let ADMIN_TOKEN: string;
let ANALYST_TOKEN: string;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  db = createTestDb();
  await runMigrations(db);

  const tokens = await getTestTokens(db);
  ADMIN_TOKEN = tokens.ADMIN_TOKEN;
  ANALYST_TOKEN = tokens.ANALYST_TOKEN;
});

beforeEach(async () => {
  await clearDatabase(db);
  // Force rule cache to reload after each test
  // (prevents stale cache from previous test's DB state)
  const { invalidateRuleCache } = await import('../src/engine/scorer');
  invalidateRuleCache();
});

afterAll(async () => {
  await closeConnections(db);
});

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

// Valid rule payload — velocity type
function validRulePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Velocity Rule',
    description: 'Created by test suite',
    type: 'velocity',
    parameters: {
      max_count: 5,
      window_minutes: 10,
    },
    severity: 'high',
    score_weight: 25,
    is_active: true,
    ...overrides,
  };
}

// Insert a rule directly via DB (faster than HTTP for setup)
async function insertRule(overrides: Record<string, unknown> = {}) {
  const [rule] = await db('rules').insert({
    name: 'Seeded Rule',
    type: 'velocity',
    parameters: JSON.stringify({ max_count: 5, window_minutes: 10 }),
    severity: 'high',
    score_weight: 25,
    is_active: true,
    ...overrides,
  }).returning('*');
  return rule;
}

// Insert a transaction directly via DB
async function insertTransaction() {
  const [tx] = await db('transactions').insert({
    external_id: `TEST-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    account_id: 'ACC-0001',
    amount: 5000,
    currency: 'CAD',
    country_code: 'CA',
    status: 'flagged',
  }).returning('*');
  return tx;
}

// Insert an alert for a rule (simulates engine generating alerts)
// Used to test the DELETE guard (>= 10 alerts → 409)
async function insertAlertsForRule(ruleId: string, count: number) {
  for (let i = 0; i < count; i++) {
    const tx = await insertTransaction();

    const [alert] = await db('alerts').insert({
      transaction_id: tx.id,
      risk_score: 25,
      severity: 'low',
      status: 'new',
    }).returning('*');

    await db('alert_rules').insert({
      alert_id: alert.id,
      rule_id: ruleId,
      score_contribution: 25,
      details: JSON.stringify({ rule_type: 'velocity', current_count: 6 }),
    });
  }
}

// ─────────────────────────────────────────
// FS-18 Required Test 1: Create rule as admin → 201
// ─────────────────────────────────────────
describe('POST /api/v1/rules', () => {

  test('1. admin can create a rule → 201', async () => {
    const payload = validRulePayload();

    const response = await request(app)
      .post('/api/v1/rules')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(response.status).toBe(201);
    expect(response.body.rule).toBeDefined();
    expect(response.body.rule.name).toBe('Test Velocity Rule');
    expect(response.body.rule.type).toBe('velocity');
    expect(response.body.rule.is_active).toBe(true);
    expect(response.body.rule.id).toBeDefined();

    // Verify it was saved to the database
    const saved = await db('rules')
      .where({ id: response.body.rule.id })
      .first();
    expect(saved).toBeDefined();
    expect(saved.name).toBe('Test Velocity Rule');
  });

  // FS-18 Required Test 2: Create rule as analyst → 403
  test('2. analyst cannot create a rule → 403', async () => {
    const payload = validRulePayload();

    const response = await request(app)
      .post('/api/v1/rules')
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send(payload);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  test('missing auth → 401', async () => {
    const response = await request(app)
      .post('/api/v1/rules')
      .send(validRulePayload());

    expect(response.status).toBe(401);
  });

  test('invalid parameters for rule type → 400', async () => {
    // velocity rule with max_count > 100 should fail
    const response = await request(app)
      .post('/api/v1/rules')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(validRulePayload({
        parameters: { max_count: 999, window_minutes: 10 },
      }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('invalid rule type → 400', async () => {
    const response = await request(app)
      .post('/api/v1/rules')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(validRulePayload({ type: 'nonexistent_type' }));

    expect(response.status).toBe(400);
  });

  test('missing required fields → 400', async () => {
    const response = await request(app)
      .post('/api/v1/rules')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Incomplete Rule' }); // missing type, parameters, severity

    expect(response.status).toBe(400);
    expect(response.body.error.details).toBeDefined();
    expect(response.body.error.details.length).toBeGreaterThan(0);
  });

  test('creates audit log entry on successful creation', async () => {
    await request(app)
      .post('/api/v1/rules')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(validRulePayload({ name: 'Audit Test Rule' }));

    const auditLog = await db('audit_logs')
      .where({ event_type: 'rule.created' })
      .first();

    expect(auditLog).toBeDefined();
    expect(auditLog.source).toBe('api');
  });
});

// ─────────────────────────────────────────
// GET /api/v1/rules
// ─────────────────────────────────────────
describe('GET /api/v1/rules', () => {

  test('analyst can list rules → 200', async () => {
    await insertRule({ name: 'Rule A' });
    await insertRule({ name: 'Rule B' });

    const response = await request(app)
      .get('/api/v1/rules')
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toBeDefined();
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBe(2);
    expect(response.body.total).toBe(2);
  });

  test('response includes hit_count_7d for each rule', async () => {
    await insertRule();

    const response = await request(app)
      .get('/api/v1/rules')
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.data[0].hit_count_7d).toBeDefined();
    expect(typeof response.body.data[0].hit_count_7d).toBe('number');
  });

  test('filter by type returns only matching rules', async () => {
    await insertRule({ name: 'Velocity Rule', type: 'velocity' });
    await insertRule({
      name: 'Round Amount Rule',
      type: 'round_amount',
      parameters: JSON.stringify({ min_amount: 1000, tolerance: 0 }),
    });

    const response = await request(app)
      .get('/api/v1/rules?type=velocity')
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBe(1);
    expect(response.body.data[0].type).toBe('velocity');
  });

  test('filter by is_active returns only active rules', async () => {
    await insertRule({ name: 'Active Rule', is_active: true });
    await insertRule({ name: 'Inactive Rule', is_active: false });

    const response = await request(app)
      .get('/api/v1/rules?is_active=true')
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBe(1);
    expect(response.body.data[0].is_active).toBe(true);
  });

  test('unauthenticated request → 401', async () => {
    const response = await request(app).get('/api/v1/rules');
    expect(response.status).toBe(401);
  });
});

// ─────────────────────────────────────────
// GET /api/v1/rules/:id
// ─────────────────────────────────────────
describe('GET /api/v1/rules/:id', () => {

  // FS-18 Required Test 4: Get rule stats returns trigger_count
  test('4. get rule stats returns trigger_count in response', async () => {
    const rule = await insertRule();

    // Seed 3 alerts for this rule so trigger_count is 3
    await insertAlertsForRule(rule.id, 3);

    const response = await request(app)
      .get(`/api/v1/rules/${rule.id}`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.rule.stats).toBeDefined();

    // FS-18 specifically requires trigger_count to be present
    expect(response.body.rule.stats.trigger_count).toBeDefined();
    expect(typeof response.body.rule.stats.trigger_count).toBe('number');

    // We seeded 3 alerts so trigger_count should be 3
    expect(response.body.rule.stats.trigger_count).toBe(3);
  });

  test('stats include all required fields', async () => {
    const rule = await insertRule();

    const response = await request(app)
      .get(`/api/v1/rules/${rule.id}`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.rule.stats).toMatchObject({
      trigger_count: expect.any(Number),
      false_positive_rate: expect.any(Number),
      avg_score: expect.any(Number),
      // last_triggered can be null if no alerts
    });
  });

  test('false_positive_rate reflects dismissed alerts', async () => {
    const rule = await insertRule();

    // Seed 4 alerts: 2 dismissed, 2 new
    await insertAlertsForRule(rule.id, 2);
    const allAlerts = await db('alerts').select('id');
    // Dismiss the first 2
    for (const alert of allAlerts.slice(0, 2)) {
      await db('alerts').where({ id: alert.id }).update({ status: 'dismissed' });
    }
    await insertAlertsForRule(rule.id, 2);

    const response = await request(app)
      .get(`/api/v1/rules/${rule.id}`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    // false_positive_rate = dismissed/total = 2/4 = 0.5
    expect(response.body.rule.stats.false_positive_rate).toBe(0.5);
  });

  test('returns 404 for non-existent rule', async () => {
    const response = await request(app)
      .get('/api/v1/rules/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

// ─────────────────────────────────────────
// PUT /api/v1/rules/:id
// ─────────────────────────────────────────
describe('PUT /api/v1/rules/:id', () => {

  test('admin can update a rule → 200', async () => {
    const rule = await insertRule({ name: 'Original Name' });

    const response = await request(app)
      .put(`/api/v1/rules/${rule.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(validRulePayload({ name: 'Updated Name' }));

    expect(response.status).toBe(200);
    expect(response.body.rule.name).toBe('Updated Name');
  });

  test('analyst cannot update a rule → 403', async () => {
    const rule = await insertRule();

    const response = await request(app)
      .put(`/api/v1/rules/${rule.id}`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send(validRulePayload({ name: 'Attempted Update' }));

    expect(response.status).toBe(403);
  });

  test('invalid parameters → 400', async () => {
    const rule = await insertRule();

    const response = await request(app)
      .put(`/api/v1/rules/${rule.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(validRulePayload({
        parameters: { max_count: 0 }, // min is 1
      }));

    expect(response.status).toBe(400);
  });

  test('creates audit log on update', async () => {
    const rule = await insertRule();

    await request(app)
      .put(`/api/v1/rules/${rule.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(validRulePayload({ name: 'Updated For Audit' }));

    const auditLog = await db('audit_logs')
      .where({ event_type: 'rule.updated', target_id: rule.id })
      .first();

    expect(auditLog).toBeDefined();
  });
});

// ─────────────────────────────────────────
// PATCH /api/v1/rules/:id/toggle
// ─────────────────────────────────────────
describe('PATCH /api/v1/rules/:id/toggle', () => {

  // FS-18 Required Test 3: Toggle rule flips is_active
  test('3. toggling a rule flips is_active from true to false', async () => {
    const rule = await insertRule({ is_active: true });

    const response = await request(app)
      .patch(`/api/v1/rules/${rule.id}/toggle`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ is_active: false });

    expect(response.status).toBe(200);
    expect(response.body.rule.is_active).toBe(false);

    // Verify it actually changed in the database
    const updated = await db('rules').where({ id: rule.id }).first();
    expect(updated.is_active).toBe(false);
  });

  test('toggling a rule flips is_active from false to true', async () => {
    const rule = await insertRule({ is_active: false });

    const response = await request(app)
      .patch(`/api/v1/rules/${rule.id}/toggle`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ is_active: true });

    expect(response.status).toBe(200);
    expect(response.body.rule.is_active).toBe(true);
  });

  test('missing is_active field → 400', async () => {
    const rule = await insertRule();

    const response = await request(app)
      .patch(`/api/v1/rules/${rule.id}/toggle`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({}); // missing is_active

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('analyst cannot toggle → 403', async () => {
    const rule = await insertRule();

    const response = await request(app)
      .patch(`/api/v1/rules/${rule.id}/toggle`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send({ is_active: false });

    expect(response.status).toBe(403);
  });

  test('creates audit log on toggle', async () => {
    const rule = await insertRule({ is_active: true });

    await request(app)
      .patch(`/api/v1/rules/${rule.id}/toggle`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ is_active: false });

    const auditLog = await db('audit_logs')
      .where({ event_type: 'rule.toggled', target_id: rule.id })
      .first();

    expect(auditLog).toBeDefined();
    const payload = typeof auditLog.payload === 'string'
      ? JSON.parse(auditLog.payload)
      : auditLog.payload;
    expect(payload.previous_is_active).toBe(true);
    expect(payload.new_is_active).toBe(false);
  });
});

// ─────────────────────────────────────────
// DELETE /api/v1/rules/:id
// ─────────────────────────────────────────
describe('DELETE /api/v1/rules/:id', () => {

  // FS-18 Required Test 5: Delete rule with > 10 alerts → 409
  test('5. delete rule with > 10 associated alerts → 409', async () => {
    const rule = await insertRule();

    // Seed 11 alerts for this rule (> 10 threshold)
    await insertAlertsForRule(rule.id, 11);

    const response = await request(app)
      .delete(`/api/v1/rules/${rule.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
    expect(response.body.error.message).toContain('11');

    // Rule should still exist in DB
    const still = await db('rules').where({ id: rule.id }).first();
    expect(still).toBeDefined();
  });

  test('delete rule with < 10 alerts → 200', async () => {
    const rule = await insertRule();
    // Seed only 5 alerts (< 10 threshold)
    await insertAlertsForRule(rule.id, 5);

    const response = await request(app)
      .delete(`/api/v1/rules/${rule.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body.deleted).toBe(true);

    // Rule should be gone from DB
    const gone = await db('rules').where({ id: rule.id }).first();
    expect(gone).toBeUndefined();
  });

  test('delete rule with exactly 10 alerts → 409 (boundary)', async () => {
    const rule = await insertRule();
    await insertAlertsForRule(rule.id, 10); // exactly 10 = refused

    const response = await request(app)
      .delete(`/api/v1/rules/${rule.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(response.status).toBe(409);
  });

  test('delete rule with 9 alerts → 200 (just under boundary)', async () => {
    const rule = await insertRule();
    await insertAlertsForRule(rule.id, 9); // 9 = allowed

    const response = await request(app)
      .delete(`/api/v1/rules/${rule.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(response.status).toBe(200);
  });

  test('analyst cannot delete → 403', async () => {
    const rule = await insertRule();

    const response = await request(app)
      .delete(`/api/v1/rules/${rule.id}`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(response.status).toBe(403);
  });

  test('delete non-existent rule → 404', async () => {
    const response = await request(app)
      .delete('/api/v1/rules/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(response.status).toBe(404);
  });

  test('creates audit log on successful deletion', async () => {
    const rule = await insertRule({ name: 'To Be Deleted' });
    // 0 alerts — safe to delete

    await request(app)
      .delete(`/api/v1/rules/${rule.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    const auditLog = await db('audit_logs')
      .where({ event_type: 'rule.deleted', target_id: rule.id })
      .first();

    expect(auditLog).toBeDefined();
    const payload = typeof auditLog.payload === 'string'
      ? JSON.parse(auditLog.payload)
      : auditLog.payload;
    expect(payload.name).toBe('To Be Deleted');
  });
});