"use strict";
// apps/api/tests/helpers/testSetup.ts
// Shared setup and teardown logic for all integration tests
//
// The lifecycle of a test run:
// beforeAll  → connect to test DB, run migrations
// beforeEach → clear all tables (fresh state for each test)
// afterAll   → close all connections (prevents Jest from hanging)
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestDb = createTestDb;
exports.runMigrations = runMigrations;
exports.clearDatabase = clearDatabase;
exports.closeConnections = closeConnections;
const knex_1 = __importDefault(require("knex"));
const path_1 = __importDefault(require("path"));
const redis_1 = require("../../src/config/redis");
const database_1 = require("../../src/config/database");
// Create a dedicated knex instance pointing at the TEST database
// This is completely separate from the main app's database connection
function createTestDb() {
    const connectionString = process.env.TEST_DATABASE_URL
        || 'postgresql://fraudscope:fraudscope123@localhost:5433/fraudscope_test';
    return (0, knex_1.default)({
        client: 'pg',
        connection: connectionString,
        migrations: {
            directory: path_1.default.resolve(__dirname, '../../migrations'),
            loadExtensions: ['.ts'],
        },
    });
}
// Run all migrations on the test database
// Called once before any tests run
async function runMigrations(db) {
    await db.migrate.latest();
    console.log('✅ Test database migrations complete');
}
// Clear all tables between tests
// Truncate is faster than dropping/recreating tables
// CASCADE handles foreign key dependencies automatically
// RESTART IDENTITY resets any sequences (not used here since we use UUIDs)
async function clearDatabase(db) {
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
}
// Close all connections cleanly
// Without this, Jest hangs after tests complete waiting for open handles
async function closeConnections(db) {
    await db.destroy(); // test db instance
    await database_1.db.destroy(); // app's db instance — this was the missing one
    await redis_1.redisClient.quit();
    await redis_1.redisPublisher.quit();
    console.log('✓ All connections closed');
}
//# sourceMappingURL=testSetup.js.map