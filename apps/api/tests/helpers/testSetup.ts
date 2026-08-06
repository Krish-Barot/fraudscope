// apps/api/tests/helpers/testSetup.ts
// Shared setup and teardown logic for all integration tests
//
// The lifecycle of a test run:
// beforeAll  → connect to test DB, run migrations
// beforeEach → clear all tables (fresh state for each test)
// afterAll   → close all connections (prevents Jest from hanging)

import knex, { Knex } from 'knex';
import path from 'path';
import { ensureSeededUsers } from './testAuth';
import { redisClient, redisPublisher } from '../../src/config/redis';
import { db as appDb } from '../../src/config/database';

// Create a dedicated knex instance pointing at the TEST database
// This is completely separate from the main app's database connection
export function createTestDb(): Knex {
  const connectionString = process.env.TEST_DATABASE_URL
    || 'postgresql://fraudscope:fraudscope123@localhost:5433/fraudscope_test';

  return knex({
    client: 'pg',
    connection: connectionString,
    migrations: {
      directory: path.resolve(__dirname, '../../migrations'),
      loadExtensions: ['.ts'],
    },
  });
}

// Run all migrations on the test database
// Called once before any tests run
export async function runMigrations(db: Knex): Promise<void> {
  await db.migrate.latest();
  await ensureSeededUsers(db);
  console.log('✅ Test database migrations complete');
}

// Clear all tables between tests
// Truncate is faster than dropping/recreating tables
// CASCADE handles foreign key dependencies automatically
// RESTART IDENTITY resets any sequences (not used here since we use UUIDs)
export async function clearDatabase(db: Knex): Promise<void> {
  // Order matters — child tables before parent tables
  // (tables that have foreign keys referencing others must be cleared first)
  await db.raw(`
    TRUNCATE TABLE
      audit_logs,
      alert_actions,
      alert_rules,
      alerts,
      transactions,
      rules,
      users
    RESTART IDENTITY CASCADE
  `);
  await ensureSeededUsers(db);
}

// Close all connections cleanly for the test suite
export async function closeConnections(db?: Knex): Promise<void> {
  if (db) {
    try {
      await db.destroy();
    } catch (err) {}
  }
  try {
    await appDb.destroy();
  } catch (err) {}
  try {
    await redisClient.quit();
  } catch (err) {}
  try {
    redisClient.disconnect();
  } catch (err) {}
  try {
    await redisPublisher.quit();
  } catch (err) {}
  try {
    redisPublisher.disconnect();
  } catch (err) {}
}