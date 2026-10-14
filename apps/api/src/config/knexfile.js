// apps/api/src/config/knexfile.js
// Plain JS so knex can load it without a TypeScript transpiler
// The migrations themselves are still TypeScript — knex loads those via tsx

'use strict';

try {
  require('tsx/cjs');
} catch {
  // If tsx is already registered or unavailable
}

const path = require('path');

/** @type {Object.<string, import('knex').Knex.Config>} */
const config = {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations: {
      directory: path.resolve(__dirname, '../../migrations'),
      // Use tsx to load TypeScript migration files
      loadExtensions: ['.ts'],
      stub: path.resolve(__dirname, '../../migrations/stub.ts'),
    },
    seeds: {
      directory: path.resolve(__dirname, '../../seeds'),
    },
  },

  test: {
    client: 'pg',
    connection: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
    migrations: {
      directory: path.resolve(__dirname, '../../migrations'),
      loadExtensions: ['.ts'],
    },
    seeds: {
      directory: path.resolve(__dirname, '../../seeds'),
    },
  },

  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations: {
      directory: path.resolve(__dirname, '../../migrations'),
      loadExtensions: ['.ts'],
    },
    pool: {
      min: 2,
      max: 10,
    },
  },
};

module.exports = config;