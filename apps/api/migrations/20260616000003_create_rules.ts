// Migration: create_rules
// Fraud detection rules that the engine evaluates against each transaction
// Parameters stored as JSONB so each rule type can have different config

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('rules', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name', 100).notNullable();
    table.text('description').nullable();

    table.string('type', 30).notNullable()
      .checkIn(
        ['velocity', 'amount_anomaly', 'geo_mismatch', 'time_anomaly', 'round_amount'],
        'rules_type_check'
      );

    // JSONB — binary JSON stored in PostgreSQL
    // Faster to query than TEXT JSON, and you can index into specific fields
    // Each rule type has different parameters:
    // velocity: { max_count: 5, window_minutes: 10 }
    // amount_anomaly: { multiplier: 3.0, min_amount: 500 }
    table.jsonb('parameters').notNullable();

    table.string('severity', 20).notNullable()
      .checkIn(['low', 'medium', 'high', 'critical'], 'rules_severity_check');

    // score_weight determines how much this rule contributes to the composite score
    table.integer('score_weight').notNullable().defaultTo(20);

    table.boolean('is_active').notNullable().defaultTo(true);

    // Who created this rule — nullable because seed data has no creator
    table.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  console.log('✓ Created rules table');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('rules');
  console.log('✓ Dropped rules table');
}