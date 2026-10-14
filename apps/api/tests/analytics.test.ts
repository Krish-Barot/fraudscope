// apps/api/tests/analytics.test.ts
// Integration tests for FraudScope analytics endpoints

import request from 'supertest';
import {
  createTestDb,
  runMigrations,
  clearDatabase,
  closeConnections,
} from './helpers/testSetup';
import { getTestTokens, SEEDED_ANALYST_ID } from './helpers/testAuth';
import { createTestApp } from './helpers/testApp';
import { Knex } from 'knex';

const app = createTestApp();
let db: Knex;
let ANALYST_TOKEN: string;

const ANALYST_ID = SEEDED_ANALYST_ID;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  db = createTestDb();
  await runMigrations(db);

  const tokens = await getTestTokens(db);
  ANALYST_TOKEN = tokens.ANALYST_TOKEN;
});

beforeEach(async () => {
  await clearDatabase(db);
});

afterAll(async () => {
  await closeConnections(db);
});

async function seedTransaction(overrides: Record<string, unknown> = {}) {
  const [tx] = await db('transactions').insert({
    external_id: `TEST-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    account_id: 'ACC-001',
    amount: 100.0,
    currency: 'CAD',
    country_code: 'CA',
    status: 'flagged',
    created_at: new Date(),
    ...overrides,
  }).returning('*');
  return tx;
}

async function seedAlert(overrides: Record<string, unknown> = {}) {
  const tx = await seedTransaction({
    created_at: overrides.created_at || new Date(),
  });
  const [alert] = await db('alerts').insert({
    transaction_id: tx.id,
    risk_score: 75,
    severity: 'high',
    status: 'new',
    created_at: new Date(),
    ...overrides,
  }).returning('*');
  return { alert, tx };
}

async function seedAlertAction(alertId: string, action: string, overrides: Record<string, unknown> = {}) {
  const [act] = await db('alert_actions').insert({
    alert_id: alertId,
    analyst_id: ANALYST_ID,
    action,
    reason: 'Investigated by test suite for verification',
    created_at: new Date(),
    ...overrides,
  }).returning('*');
  return act;
}

// ─────────────────────────────────────────
// GET /api/v1/analytics/alert-volume
// ─────────────────────────────────────────
describe('GET /api/v1/analytics/alert-volume', () => {
  test('requires authentication → 401', async () => {
    const res = await request(app).get('/api/v1/analytics/alert-volume');
    expect(res.status).toBe(401);
  });

  test('returns 200 with zero-filled structure on empty dataset', async () => {
    const from = '2026-10-01T00:00:00.000Z';
    const to = '2026-10-05T23:59:59.999Z';

    const res = await request(app)
      .get(`/api/v1/analytics/alert-volume?from=${from}&to=${to}&bust=true`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.group_by).toBe('day');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);

    for (const point of res.body.data) {
      expect(point.low).toBe(0);
      expect(point.medium).toBe(0);
      expect(point.high).toBe(0);
      expect(point.critical).toBe(0);
      expect(point.total).toBe(0);
      expect(point.period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('groups multiple severities on the same day correctly', async () => {
    const day = '2026-10-03T12:00:00.000Z';
    const from = '2026-10-01T00:00:00.000Z';
    const to = '2026-10-05T23:59:59.999Z';

    // Insert multiple alerts with different severities on the same day
    await seedAlert({ severity: 'low', created_at: day });
    await seedAlert({ severity: 'low', created_at: day });
    await seedAlert({ severity: 'medium', created_at: day });
    await seedAlert({ severity: 'high', created_at: day });
    await seedAlert({ severity: 'high', created_at: day });
    await seedAlert({ severity: 'critical', created_at: day });

    const res = await request(app)
      .get(`/api/v1/analytics/alert-volume?from=${from}&to=${to}&bust=true`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.group_by).toBe('day');

    const dayPoint = res.body.data.find((p: any) => p.period === '2026-10-03');
    expect(dayPoint).toBeDefined();
    expect(dayPoint.low).toBe(2);
    expect(dayPoint.medium).toBe(1);
    expect(dayPoint.high).toBe(2);
    expect(dayPoint.critical).toBe(1);
    expect(dayPoint.total).toBe(6);
  });

  test('respects date boundaries (excludes alerts outside range)', async () => {
    const from = '2026-10-02T00:00:00.000Z';
    const to = '2026-10-04T23:59:59.999Z';

    // Before range
    await seedAlert({ severity: 'critical', created_at: '2026-10-01T12:00:00.000Z' });
    // In range
    await seedAlert({ severity: 'critical', created_at: '2026-10-03T12:00:00.000Z' });
    // After range
    await seedAlert({ severity: 'critical', created_at: '2026-10-06T12:00:00.000Z' });

    const res = await request(app)
      .get(`/api/v1/analytics/alert-volume?from=${from}&to=${to}&bust=true`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(200);

    const targetDay = res.body.data.find((p: any) => p.period === '2026-10-03');
    expect(targetDay).toBeDefined();
    expect(targetDay.critical).toBe(1);

    const outsideBefore = res.body.data.find((p: any) => p.period === '2026-10-01');
    expect(outsideBefore).toBeUndefined();

    const outsideAfter = res.body.data.find((p: any) => p.period === '2026-10-06');
    expect(outsideAfter).toBeUndefined();
  });

  test('uses hourly grouping when duration is <= 48 hours', async () => {
    const from = '2026-10-03T00:00:00.000Z';
    const to = '2026-10-04T12:00:00.000Z'; // 36 hours

    await seedAlert({ severity: 'high', created_at: '2026-10-03T05:22:00.000Z' });

    const res = await request(app)
      .get(`/api/v1/analytics/alert-volume?from=${from}&to=${to}&bust=true`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.group_by).toBe('hour');
    const hourPoint = res.body.data.find((p: any) => p.period === '2026-10-03T05:00');
    expect(hourPoint).toBeDefined();
    expect(hourPoint.high).toBe(1);
    expect(hourPoint.total).toBe(1);
  });
});

// ─────────────────────────────────────────
// GET /api/v1/analytics/resolution
// ─────────────────────────────────────────
describe('GET /api/v1/analytics/resolution', () => {
  test('requires authentication → 401', async () => {
    const res = await request(app).get('/api/v1/analytics/resolution');
    expect(res.status).toBe(401);
  });

  test('returns 200 with empty dataset and correct summary zeros', async () => {
    const from = '2026-10-01T00:00:00.000Z';
    const to = '2026-10-05T23:59:59.999Z';

    const res = await request(app)
      .get(`/api/v1/analytics/resolution?from=${from}&to=${to}&bust=true`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.group_by).toBe('day');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.summary).toMatchObject({
      total_resolved: 0,
      resolution_rate: 0,
      total_dismissed: 0,
      total_escalated: 0,
      total_investigated: 0,
      avg_time_dismiss: '0s',
      avg_time_escalate: '0s',
      avg_time_investigate: '0s',
    });
  });

  test('groups multiple actions on the same day and calculates resolution interval', async () => {
    const from = '2026-10-01T00:00:00.000Z';
    const to = '2026-10-05T23:59:59.999Z';

    // Alert created at 10:00:00, dismissed at 10:05:00 (300 seconds)
    const { alert: a1 } = await seedAlert({ created_at: '2026-10-03T10:00:00.000Z' });
    await seedAlertAction(a1.id, 'dismiss', { created_at: '2026-10-03T10:05:00.000Z' });

    // Alert created at 11:00:00, dismissed at 11:15:00 (900 seconds)
    // Avg dismiss time = (300 + 900) / 2 = 600 seconds = 10m
    const { alert: a2 } = await seedAlert({ created_at: '2026-10-03T11:00:00.000Z' });
    await seedAlertAction(a2.id, 'dismiss', { created_at: '2026-10-03T11:15:00.000Z' });

    // Alert created at 12:00:00, escalated at 12:02:00 (120 seconds = 2m)
    const { alert: a3 } = await seedAlert({ created_at: '2026-10-03T12:00:00.000Z' });
    await seedAlertAction(a3.id, 'escalate', { created_at: '2026-10-03T12:02:00.000Z' });

    // Alert created at 13:00:00, investigated at 13:30:00 (1800 seconds = 30m)
    const { alert: a4 } = await seedAlert({ created_at: '2026-10-03T13:00:00.000Z' });
    await seedAlertAction(a4.id, 'investigate', { created_at: '2026-10-03T13:30:00.000Z' });

    const res = await request(app)
      .get(`/api/v1/analytics/resolution?from=${from}&to=${to}&bust=true`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.group_by).toBe('day');

    const dayPoint = res.body.data.find((p: any) => p.period === '2026-10-03');
    expect(dayPoint).toBeDefined();
    expect(dayPoint.dismiss).toBe(2);
    expect(dayPoint.escalate).toBe(1);
    expect(dayPoint.investigate).toBe(1);
    expect(dayPoint.total).toBe(4);

    expect(res.body.summary.total_dismissed).toBe(2);
    expect(res.body.summary.total_escalated).toBe(1);
    expect(res.body.summary.total_investigated).toBe(1);
    expect(res.body.summary.total_resolved).toBe(3); // dismiss + escalate
    expect(res.body.summary.avg_time_dismiss).toBe('10m 0s');
    expect(res.body.summary.avg_time_escalate).toBe('2m 0s');
    expect(res.body.summary.avg_time_investigate).toBe('30m 0s');
  });

  test('respects date boundaries for actions', async () => {
    const from = '2026-10-02T00:00:00.000Z';
    const to = '2026-10-04T23:59:59.999Z';

    const { alert } = await seedAlert({ created_at: '2026-10-01T00:00:00.000Z' });

    // Action outside range (before)
    await seedAlertAction(alert.id, 'dismiss', { created_at: '2026-10-01T12:00:00.000Z' });
    // Action inside range
    await seedAlertAction(alert.id, 'escalate', { created_at: '2026-10-03T12:00:00.000Z' });
    // Action outside range (after)
    await seedAlertAction(alert.id, 'investigate', { created_at: '2026-10-05T12:00:00.000Z' });

    const res = await request(app)
      .get(`/api/v1/analytics/resolution?from=${from}&to=${to}&bust=true`)
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.total_dismissed).toBe(0);
    expect(res.body.summary.total_escalated).toBe(1);
    expect(res.body.summary.total_investigated).toBe(0);
  });
});
