// Migration: create_alerts
// Created by the rule engine when a transaction scores >= 20
// References transactions (what triggered it) and users (who it's assigned to)

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("alerts", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));

    // Which transaction triggered this alert
    table
      .uuid("transaction_id")
      .notNullable()
      .references("id")
      .inTable("transactions")
      .onDelete("CASCADE");
    //                                                    ^^^^^^^^
    // CASCADE means if the transaction is deleted, this alert is also deleted
    // Keeps the database consistent — no orphaned alerts

    table.integer("risk_score").notNullable();
    table
      .string("severity", 20)
      .notNullable()
      .checkIn(["low", "medium", "high", "critical"], "alerts_severity_check");

    table
      .string("status", 20)
      .notNullable()
      .defaultTo("new")
      .checkIn(
        ["new", "reviewing", "dismissed", "escalated", "investigating"],
        "alerts_status_check",
      );

    // Which analyst is currently reviewing this alert (nullable — unassigned by default)
    table
      .uuid("assigned_to")
      .nullable()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");

    table
      .timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.timestamp("resolved_at", { useTz: true }).nullable(); // set when dismissed or escalated
  });

  // Most important index — the alert queue sorts by status + risk_score DESC
  // Analysts always see the highest-risk unreviewed alerts first
  await knex.raw(
    "CREATE INDEX idx_alerts_status_score ON alerts(status, risk_score DESC)",
  );
  await knex.raw(
    "CREATE INDEX idx_alerts_severity ON alerts(severity, created_at DESC)",
  );
  await knex.raw("CREATE INDEX idx_alerts_tx ON alerts(transaction_id)");

  // Partial index — only index alerts that are actively being worked on
  await knex.raw(`CREATE INDEX idx_alerts_assigned ON alerts(assigned_to) 
    WHERE status IN ('reviewing', 'investigating')`);

  console.log("✓ Created alerts table");
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("alerts");
  console.log("✓ Dropped alerts table");
}
