// apps/api/src/config/database.ts
// This file creates the Knex instance that the rest of the app uses
// to run queries. Import 'db' from here whenever you need to query.

import knex from 'knex';
import knexConfig from './knexfile';

// Pick the right config based on NODE_ENV
const environment = process.env.NODE_ENV || 'development';
const config = knexConfig[environment];

// Create and export the database connection
// This is a connection pool — Knex manages multiple connections automatically
export const db = knex(config);

// Test the connection on startup
export async function connectDatabase(): Promise<void>{
    try {
        await db.raw('SELECT 1'); // simplest possible query - just checks connection works
        console.log('✅ Database connected !');
    } catch (error) {
        console.error('❌ Database connection failed : ', error);
        process.exit(1); // crash the process — app is useless without a DB
    }
}