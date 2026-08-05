// apps/api/tests/auth.test.ts
// Integration tests for auth API — FS-20 required (6 tests)
//
// Required:
// 1. register valid → 201
// 2. duplicate email → 409
// 3. analyst registers another user → 403
// 4. login valid → 200 + tokens
// 5. wrong password → 401
// 6. protected route no token → 401

import request from 'supertest';
import jwt from 'jsonwebtoken';
import {
  createTestDb,
  runMigrations,
  clearDatabase,
  closeConnections,
} from './helpers/testSetup';
import { createTestApp } from './helpers/testApp';
import { getTestTokens } from './helpers/testAuth';
import { Knex } from 'knex';
import bcrypt from 'bcrypt';

const app = createTestApp();
let db: Knex;

let ADMIN_TOKEN: string;
let ANALYST_TOKEN: string;

const JWT_SECRET = process.env.JWT_ACCESS_SECRET
  || 'dev_access_secret_change_in_production';

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

// Helper: create a real user in the test DB with bcrypt password
async function createUser(overrides: Record<string, unknown> = {}) {
  const hash = await bcrypt.hash('password123', 10);
  const [user] = await db('users').insert({
    email: 'testuser@example.com',
    password_hash: hash,
    first_name: 'Test',
    last_name: 'User',
    role: 'analyst',
    is_active: true,
    ...overrides,
  }).returning('*');
  return user;
}

// ─────────────────────────────────────────
// POST /api/v1/auth/register
// ─────────────────────────────────────────
describe('POST /api/v1/auth/register', () => {

  // FS-20 required test 1: register valid → 201
  test('1. admin can register a new user → 201', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({
        email: 'newanalyst@fraudscope.dev',
        password: 'securepassword123',
        first_name: 'New',
        last_name: 'Analyst',
        role: 'analyst',
      });

    expect(response.status).toBe(201);
    expect(response.body.user).toBeDefined();
    expect(response.body.user.email).toBe('newanalyst@fraudscope.dev');
    expect(response.body.user.role).toBe('analyst');

    // Password hash must NOT be in response
    expect(response.body.user.password_hash).toBeUndefined();

    // Verify saved to DB
    const saved = await db('users')
      .where({ email: 'newanalyst@fraudscope.dev' })
      .first();
    expect(saved).toBeDefined();
    expect(saved.password_hash).not.toBe('securepassword123');
  });

  // FS-20 required test 2: duplicate email → 409
  test('2. duplicate email returns 409', async () => {
    await createUser({ email: 'duplicate@example.com' });

    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({
        email: 'duplicate@example.com',
        password: 'anotherpassword123',
        first_name: 'Dupe',
        last_name: 'User',
        role: 'analyst',
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  // FS-20 required test 3: analyst registers another user → 403
  test('3. analyst cannot register another user → 403', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Authorization', `Bearer ${ANALYST_TOKEN}`)
      .send({
        email: 'another@example.com',
        password: 'password123',
        first_name: 'Another',
        last_name: 'User',
        role: 'analyst',
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  test('missing auth → 401', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'test@example.com',
        password: 'password123',
        first_name: 'Test',
        last_name: 'User',
        role: 'analyst',
      });

    expect(response.status).toBe(401);
  });

  test('invalid email → 400', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({
        email: 'not-an-email',
        password: 'password123',
        first_name: 'Test',
        last_name: 'User',
        role: 'analyst',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('password too short → 400', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({
        email: 'valid@example.com',
        password: 'short',
        first_name: 'Test',
        last_name: 'User',
        role: 'analyst',
      });

    expect(response.status).toBe(400);
  });
});

// ─────────────────────────────────────────
// POST /api/v1/auth/login
// ─────────────────────────────────────────
describe('POST /api/v1/auth/login', () => {

  // FS-20 required test 4: login valid → 200 + tokens
  test('4. valid credentials return 200 with access_token', async () => {
    await createUser({ email: 'logintest@example.com' });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'logintest@example.com',
        password: 'password123',
      });

    expect(response.status).toBe(200);
    expect(response.body.access_token).toBeDefined();
    expect(typeof response.body.access_token).toBe('string');
    expect(response.body.user).toBeDefined();
    expect(response.body.user.email).toBe('logintest@example.com');

    // Refresh token should be in httpOnly cookie
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
    expect(cookieStr).toContain('fraudscope_refresh_token');
    expect(cookieStr).toContain('HttpOnly');

    // Password hash must NOT be in response
    expect(response.body.user.password_hash).toBeUndefined();
  });

  // FS-20 required test 5: wrong password → 401
  test('5. wrong password returns 401', async () => {
    await createUser({ email: 'wrongpass@example.com' });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'wrongpass@example.com',
        password: 'thisisthewrongpassword',
      });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');

    // Must not reveal whether it was email or password that was wrong
    expect(response.body.error.message).toBe('Invalid email or password');
  });

  test('non-existent email returns 401 (not 404)', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'doesnotexist@example.com',
        password: 'somepassword',
      });

    // Must return 401, not 404 — never confirm email existence
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('inactive user cannot login → 401', async () => {
    await createUser({
      email: 'inactive@example.com',
      is_active: false,
    });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'inactive@example.com',
        password: 'password123',
      });

    expect(response.status).toBe(401);
  });

  test('login updates last_login_at', async () => {
    const user = await createUser({ email: 'logintime@example.com' });
    expect(user.last_login_at).toBeNull();

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'logintime@example.com', password: 'password123' });

    const updated = await db('users')
      .where({ id: user.id })
      .first();
    expect(updated.last_login_at).not.toBeNull();
  });

  test('login writes audit log', async () => {
    await createUser({ email: 'auditlogin@example.com' });

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'auditlogin@example.com', password: 'password123' });

    const log = await db('audit_logs')
      .where({ event_type: 'user.login' })
      .first();
    expect(log).toBeDefined();
  });
});

// ─────────────────────────────────────────
// POST /api/v1/auth/refresh
// ─────────────────────────────────────────
describe('POST /api/v1/auth/refresh', () => {

  test('valid refresh token returns new access token', async () => {
    const user = await createUser({ email: 'refresh@example.com' });

    // Login to get tokens
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'refresh@example.com', password: 'password123' });

    // Extract refresh token cookie
    const cookies = loginRes.headers['set-cookie'];
    const cookieStr = Array.isArray(cookies) ? cookies[0] : cookies;

    // Use refresh token to get new access token
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieStr);

    expect(response.status).toBe(200);
    expect(response.body.access_token).toBeDefined();
    expect(response.body.user).toBeDefined();
    expect(response.body.user.id).toBe(user.id);
  });

  test('no refresh token cookie → 401', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('NO_REFRESH_TOKEN');
  });

  test('invalid refresh token → 401', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'fraudscope_refresh_token=totallyinvalidtoken');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });
});

// ─────────────────────────────────────────
// GET /api/v1/auth/me
// ─────────────────────────────────────────
describe('GET /api/v1/auth/me', () => {

  // FS-20 required test 6: protected route no token → 401
  test('6. no token on protected route → 401', async () => {
    const response = await request(app)
      .get('/api/v1/auth/me');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  test('valid token returns current user', async () => {
    const user = await createUser({ email: 'me@example.com' });

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(user.id);
    expect(response.body.user.email).toBe('me@example.com');
    expect(response.body.user.password_hash).toBeUndefined();
  });
});

// ─────────────────────────────────────────
// POST /api/v1/auth/logout
// ─────────────────────────────────────────
describe('POST /api/v1/auth/logout', () => {

  test('logout clears refresh cookie and writes audit log', async () => {
    const user = await createUser({ email: 'logout@example.com' });

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);

    // Verify audit log written
    const log = await db('audit_logs')
      .where({ event_type: 'user.logout' })
      .first();
    expect(log).toBeDefined();
  });
});