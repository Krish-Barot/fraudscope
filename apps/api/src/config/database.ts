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

export const db = knex({
  client: 'pg',
  connection: connectionString,
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
    process.exit(1);
  }
}