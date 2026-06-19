// Migration: create_audit_logs
// System-wide immutable event log
// Every significant event gets written here: transactions ingested,
// alerts generated, analyst actions, rule changes, user logins
// Think of this as the "black box recorder" for the entire system

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("audit_logs", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));

    // What happened — e.g. 'transaction.ingested', 'alert.generated', 'user.login'
    table.string("event_type", 50).notNullable();

    // Who did it — nullable because system/engine events have no human actor
    table
      .uuid("actor_id")
      .nullable()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");

    table
      .string("actor_type", 20)
      .notNullable()
      .defaultTo("user")
      .checkIn(["user", "system", "api"], "audit_logs_actor_type_check");

    // What was affected — 'transaction', 'alert', 'rule', 'user'
    table.string("target_type", 30).nullable();
    table.uuid("target_id").nullable(); // ID of the affected record

    // Full event payload — whatever context is useful for debugging
    table.jsonb("payload").nullable();

    table.specificType("ip_address", "INET").nullable();

    // Where did this event originate — 'api', 'dashboard', 'engine', 'scheduler'
    table.string("source", 50).nullable();

    table
      .timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.raw(
    "CREATE INDEX idx_audit_event ON audit_logs(event_type, created_at DESC)",
  );
  await knex.raw(
    "CREATE INDEX idx_audit_actor ON audit_logs(actor_id, created_at DESC)",
  );
  await knex.raw(
    "CREATE INDEX idx_audit_target ON audit_logs(target_type, target_id)",
  );
  await knex.raw(
    "CREATE INDEX idx_audit_created ON audit_logs(created_at DESC)",
  );

  console.log("✅ Created audit_logs table");
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("audit_logs");
  console.log("✅ Dropped audit_logs table");
}
