// Migration: create_transactions
// Every financial transaction flowing through FraudScope is stored here
// Status starts as 'clean' and changes to 'flagged' if the rule engine fires

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('transactions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    // external_id is the ID from the source system (bank, payment processor)
    // Must be unique so we don't process the same transaction twice
    table.string('external_id', 100).notNullable().unique();

    table.string('account_id', 50).notNullable();

    // decimal(15, 2) — up to 15 digits total, 2 decimal places
    // Correct type for money — never use float for currency (floating point errors)
    table.decimal('amount', 15, 2).notNullable();

    table.string('currency', 3).notNullable().defaultTo('CAD');
    table.string('merchant_name', 255).nullable();
    table.string('merchant_category', 100).nullable();

    // ISO 3166-1 alpha-2 country code (CA, US, NG, etc.)
    table.string('country_code', 3).notNullable();
    table.string('city', 100).nullable();

    // INET is a PostgreSQL-specific type for IP addresses
    // Stores both IPv4 and IPv6 efficiently
    table.specificType('ip_address', 'INET').nullable();

    // Geographic coordinates for the map in the transaction detail page
    table.decimal('latitude', 10, 7).nullable();
    table.decimal('longitude', 10, 7).nullable();

    table.string('channel', 20).nullable()
      .checkIn(['online', 'pos', 'atm', 'mobile', 'wire'], 'transactions_channel_check');

    table.string('status', 20).notNullable().defaultTo('clean')
      .checkIn(['clean', 'flagged', 'blocked'], 'transactions_status_check');

    table.timestamp('processed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Compound index on account_id + created_at DESC
  // This is the most important index — almost every query filters by account
  // and sorts by time. The compound index covers both in one lookup.
  await knex.raw('CREATE INDEX idx_tx_account_created ON transactions(account_id, created_at DESC)');

  // For filtering the alert queue by status
  await knex.raw('CREATE INDEX idx_tx_status_created ON transactions(status, created_at DESC)');

  // Partial index — only indexes high-value transactions
  // Most fraud involves large amounts, so this keeps the index small and fast
  await knex.raw('CREATE INDEX idx_tx_amount ON transactions(amount) WHERE amount > 1000');

  await knex.raw('CREATE INDEX idx_tx_country ON transactions(country_code, created_at DESC)');
  await knex.raw('CREATE INDEX idx_tx_created ON transactions(created_at DESC)');

  console.log('✓ Created transactions table');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('transactions');
  console.log('✓ Dropped transactions table');
}