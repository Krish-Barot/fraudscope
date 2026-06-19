// Migration: create_alert_actions
// Every action an analyst takes on an alert is recorded here permanently
// This is the audit trail — immutable record of who did what and why

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("alert_actions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));

    table
      .uuid("alert_id")
      .notNullable()
      .references("id")
      .inTable("alerts")
      .onDelete("CASCADE");

    table
      .uuid("analyst_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("RESTRICT");
    // RESTRICT — cannot delete a user who has taken actions (audit trail must be preserved)

    table
      .string("action", 20)
      .notNullable()
      .checkIn(
        ["dismiss", "escalate", "investigate", "reassign", "comment"],
        "alert_actions_action_check",
      );

    // Reason is required — analysts must explain every action they take
    // Minimum enforced at the API layer, stored here
    table.text("reason").notNullable();

    // Snapshot of the status change for the audit log
    table.string("previous_status", 20).nullable();
    table.string("new_status", 20).nullable();

    table
      .timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.raw(
    "CREATE INDEX idx_alert_actions_alert ON alert_actions(alert_id)",
  );
  await knex.raw(
    "CREATE INDEX idx_alert_actions_analyst ON alert_actions(analyst_id, created_at DESC)",
  );

  console.log("✅ Created alert_actions table");
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("alert_actions");
  console.log("✅ Dropped alert_actions table");
}
