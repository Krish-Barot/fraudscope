// apps/api/src/config/database.ts
// This file creates the Knex instance that the rest of the app uses
// to run queries. Import 'db' from here whenever you need to query.
import knex from 'knex';
import path from 'path';

// Use TEST_DATABASE_URL when running tests
// This is set automatically by Jest via the test environment
const connectionString = process.env.NODE_ENV === 'test'
  ? (process.env.TEST_DATABASE_URL || 'postgresql://fraudscope:fraudscope123@localhost:5433/fraudscope_test')
  : (process.env.DATABASE_URL || 'postgresql://fraudscope:fraudscope123@localhost:5432/fraudscope');

const isLocalhost = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
const useSsl = process.env.DATABASE_SSL === 'true' || 
  (!isLocalhost && process.env.NODE_ENV === 'production') || 
  connectionString.includes('sslmode=require');

export const db = knex({
  client: 'pg',
  connection: useSsl
    ? {
        connectionString,
        ssl: { rejectUnauthorized: false },
      }
    : connectionString,
  pool: {
    min: 0,
    max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 10,
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: 10000,
  },
  migrations: {
    directory: path.resolve(__dirname, '../../migrations'),
    loadExtensions: ['.ts'],
  },
});

export async function connectDatabase(): Promise<void> {
  try {
    await db.raw('SELECT 1');
    console.log('✅ Database connected');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    if (!process.env.VERCEL) {
      process.exit(1);
    }
    throw error;
  }
}