// apps/api/tests/users.test.ts
// Integration tests for users API — FS-28

import request from 'supertest';
import bcrypt from 'bcrypt';
import { Knex } from 'knex';
import {
  createTestDb,
  runMigrations,
  clearDatabase,
  closeConnections,
} from './helpers/testSetup';
import { createTestApp } from './helpers/testApp';
import { getTestTokens } from './helpers/testAuth';

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
});

afterAll(async () => {
  await closeConnections(db);
});

async function createTestUser(overrides: Record<string, unknown> = {}) {
  const hash = await bcrypt.hash('password123', 10);
  const [user] = await db('users')
    .insert({
      email: `user_${Date.now()}_${Math.random().toString(36).substring(7)}@fraudscope.dev`,
      password_hash: hash,
      first_name: 'Test',
      last_name: 'User',
      role: 'analyst',
      is_active: true,
      ...overrides,
    })
    .returning('*');
  return user;
}

describe('Users API (FS-28)', () => {
  describe('GET /api/v1/users', () => {
    it('returns 401 when no token is provided', async () => {
      const res = await request(app).get('/api/v1/users');
      expect(res.status).toBe(401);
    });

    it('returns 403 when called by an analyst', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${ANALYST_TOKEN}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 200 with list of users and stats when called by an admin', async () => {
      await createTestUser({ first_name: 'Alice', last_name: 'Smith' });
      await createTestUser({ first_name: 'Bob', last_name: 'Jones', role: 'admin' });

      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
      expect(res.body.users.length).toBeGreaterThanOrEqual(2);

      const alice = res.body.users.find((u: any) => u.first_name === 'Alice');
      expect(alice).toBeDefined();
      expect(alice).not.toHaveProperty('password_hash');
      expect(alice.stats).toBeDefined();
      expect(typeof alice.stats.alerts_reviewed).toBe('number');
      expect(typeof alice.stats.avg_response_time_seconds).toBe('number');
      expect(typeof alice.stats.escalation_rate).toBe('number');
    });
  });

  describe('GET /api/v1/users/:id', () => {
    it('returns 404 if user does not exist', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .get(`/api/v1/users/${fakeId}`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 200 with user detail and stats', async () => {
      const user = await createTestUser({ first_name: 'Charlie' });

      const res = await request(app)
        .get(`/api/v1/users/${user.id}`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(user.id);
      expect(res.body.user.first_name).toBe('Charlie');
      expect(res.body.stats).toBeDefined();
    });
  });

  describe('PATCH /api/v1/users/:id', () => {
    it('updates user role and is_active and logs audit trail', async () => {
      const user = await createTestUser({ role: 'analyst', is_active: true });

      const res = await request(app)
        .patch(`/api/v1/users/${user.id}`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({
          role: 'admin',
          is_active: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('admin');
      expect(res.body.user.is_active).toBe(false);

      // Verify in DB
      const updated = await db('users').where({ id: user.id }).first();
      expect(updated.role).toBe('admin');
      expect(updated.is_active).toBe(false);

      // Verify audit log
      const auditLog = await db('audit_logs')
        .where({ target_type: 'user', target_id: user.id })
        .orderBy('created_at', 'desc')
        .first();

      expect(auditLog).toBeDefined();
      expect(auditLog.event_type).toBe('user.role_changed');
    });

    it('updates user first_name and last_name', async () => {
      const user = await createTestUser({ first_name: 'Original', last_name: 'Name' });

      const res = await request(app)
        .patch(`/api/v1/users/${user.id}`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({
          first_name: 'UpdatedFirst',
          last_name: 'UpdatedLast',
        });

      expect(res.status).toBe(200);
      expect(res.body.user.first_name).toBe('UpdatedFirst');
      expect(res.body.user.last_name).toBe('UpdatedLast');

      const updated = await db('users').where({ id: user.id }).first();
      expect(updated.first_name).toBe('UpdatedFirst');
      expect(updated.last_name).toBe('UpdatedLast');
    });

    it('returns 400 when body has no update fields', async () => {
      const user = await createTestUser();

      const res = await request(app)
        .patch(`/api/v1/users/${user.id}`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/users', () => {
    it('creates a new user and returns 201', async () => {
      const email = `new_analyst_${Date.now()}@fraudscope.dev`;
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({
          email,
          first_name: 'David',
          last_name: 'Kim',
          role: 'analyst',
        });

      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe(email);
      expect(res.body.user.first_name).toBe('David');
      expect(res.body.temp_password).toBeDefined();

      // Check DB
      const dbUser = await db('users').where({ email }).first();
      expect(dbUser).toBeDefined();
      expect(dbUser.role).toBe('analyst');
    });
  });
});
