// apps/api/tests/engine-worker-event.test.ts
// Tests for event-driven engine processing, idempotency, and Vercel Cron sweeping

import request from 'supertest';
import { Knex } from 'knex';
import {
  createTestDb,
  runMigrations,
  clearDatabase,
  closeConnections,
} from './helpers/testSetup';
import { app } from '../src/app';

let db: Knex;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  db = createTestDb();
  await runMigrations(db);
});

import { invalidateRuleCache } from '../src/engine/scorer';

beforeEach(async () => {
  await clearDatabase(db);
  invalidateRuleCache();
});

afterAll(async () => {
  await closeConnections(db);
});

// Helper to seed a round-amount rule (triggers on round multiples >= 1000)
async function seedRoundAmountRule(): Promise<void> {
  await db('rules').insert({
    name: 'Round Amount Test',
    description: 'Flags round dollar amounts',
    type: 'round_amount',
    severity: 'medium',
    score_weight: 45,
    parameters: JSON.stringify({ min_amount: 1000, tolerance: 0 }),
    is_active: true,
  });
}

// Helper to seed a transaction
async function seedTransaction(amount: number) {
  const [tx] = await db('transactions')
    .insert({
      external_id: `tx-event-${Date.now()}-${Math.random()}`,
      account_id: 'acc-test-123',
      amount,
      currency: 'USD',
      country_code: 'US',
      channel: 'online',
      status: 'clean',
    })
    .returning('*');
  return tx;
}

describe('Event-driven Rule Engine & Idempotency', () => {
  test('POST /api/v1/engine/process evaluates transaction and flags when score >= 20', async () => {
    await seedRoundAmountRule();
    const tx = await seedTransaction(5000); // 5000 triggers round_amount

    const res = await request(app)
      .post('/api/v1/engine/process')
      .send({ transaction_id: tx.id });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('evaluated');
    expect(res.body.result.alert_id).not.toBeNull();
    expect(res.body.result.score).toBeGreaterThanOrEqual(20);

    // Verify DB state
    const updatedTx = await db('transactions').where({ id: tx.id }).first();
    expect(updatedTx.status).toBe('flagged');
    expect(updatedTx.processed_at).not.toBeNull();

    const alert = await db('alerts').where({ id: res.body.result.alert_id }).first();
    expect(alert).toBeDefined();
    expect(alert.status).toBe('new');
  });

  test('POST /api/v1/engine/process is strictly idempotent on duplicate invocations', async () => {
    await seedRoundAmountRule();
    const tx = await seedTransaction(5000);

    // First call
    const firstRes = await request(app)
      .post('/api/v1/engine/process')
      .send({ transaction_id: tx.id });

    expect(firstRes.status).toBe(200);
    expect(firstRes.body.status).toBe('evaluated');
    const firstAlertId = firstRes.body.result.alert_id;

    // Count alerts before second call
    const alertCountBefore = await db('alerts').where({ transaction_id: tx.id }).count('id as c');

    // Second call (simulating queue redelivery or duplicate invocation)
    const secondRes = await request(app)
      .post('/api/v1/engine/process')
      .send({ transaction_id: tx.id });

    expect(secondRes.status).toBe(200);
    expect(secondRes.body.status).toBe('already_processed');
    expect(secondRes.body.result.alert_id).toBe(firstAlertId);

    // Verify no duplicate alerts were inserted
    const alertCountAfter = await db('alerts').where({ transaction_id: tx.id }).count('id as c');
    expect(alertCountAfter[0].c).toBe(alertCountBefore[0].c);
  });

  test('POST /api/v1/engine/process marks clean transaction as processed without alert', async () => {
    await seedRoundAmountRule();
    const tx = await seedTransaction(123.45); // Not round, won't trigger

    const res = await request(app)
      .post('/api/v1/engine/process')
      .send({ transaction_id: tx.id });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('evaluated');
    expect(res.body.result.alert_id).toBeNull();

    const updatedTx = await db('transactions').where({ id: tx.id }).first();
    expect(updatedTx.status).toBe('clean');
    expect(updatedTx.processed_at).not.toBeNull();

    const alerts = await db('alerts').where({ transaction_id: tx.id });
    expect(alerts.length).toBe(0);
  });

  test('GET /api/v1/engine/cron sweeps pending un-evaluated transactions', async () => {
    await seedRoundAmountRule();
    // Insert 2 transactions without processed_at
    const tx1 = await seedTransaction(5000); // flagged
    const tx2 = await seedTransaction(42.50); // clean

    const res = await request(app).get('/api/v1/engine/cron?limit=10');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary.processed).toBe(2);
    expect(res.body.summary.flagged).toBe(1);
    expect(res.body.summary.clean).toBe(1);

    const check1 = await db('transactions').where({ id: tx1.id }).first();
    expect(check1.processed_at).not.toBeNull();
    expect(check1.status).toBe('flagged');

    const check2 = await db('transactions').where({ id: tx2.id }).first();
    expect(check2.processed_at).not.toBeNull();
    expect(check2.status).toBe('clean');
  });
});
