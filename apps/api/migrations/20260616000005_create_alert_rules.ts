// Migration: create_alert_rules
// Junction table — records WHICH rules fired for each alert and by how much
// One alert can be triggered by multiple rules (e.g. velocity + geo_mismatch)
// This is separate from alerts so we can show "why was this flagged" in the UI

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('alert_rules', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('alert_id').notNullable()
      .references('id').inTable('alerts').onDelete('CASCADE');
    // If the alert is deleted, remove the rule breakdown too

    table.uuid('rule_id').notNullable()
      .references('id').inTable('rules').onDelete('RESTRICT');
    // RESTRICT — cannot delete a rule if alerts reference it
    // Forces you to deactivate rules instead of deleting them

    // How many points did this specific rule contribute to the composite score?
    table.integer('score_contribution').notNullable();

    // Rule-specific explanation stored as JSON
    // velocity example: { current_count: 8, threshold: 5, window_minutes: 10,
    //                     message: "8 transactions in 10 minutes" }
    table.jsonb('details').notNullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw('CREATE INDEX idx_alert_rules_alert ON alert_rules(alert_id)');
  await knex.raw('CREATE INDEX idx_alert_rules_rule ON alert_rules(rule_id)');

  console.log('✅ Created alert_rules table');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('alert_rules');
  console.log('✅ Dropped alert_rules table');
}