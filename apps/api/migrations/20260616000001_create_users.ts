// Migration: create_users
// Users are analysts and admins who log into the FraudScope dashboard
// This must be created FIRST because other tables reference it via foreign keys

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("users", (table) => {
    // Primary key — UUID instead of integer
    // UUIDs are harder to guess (security) and work across distributed systems
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));

    table.string("email", 255).notNullable().unique();
    table.string("password_hash", 255).notNullable();
    table.string("first_name", 100).notNullable();
    table.string("last_name", 100).notNullable();

    // Role determines what the user can see and do
    // CHECK constraint enforces only these two values are allowed
    table
      .string("role", 20)
      .notNullable()
      .checkIn(["analyst", "admin"], "users_role_check");

    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("last_login_at", { useTz: true }).nullable();

    // useTz: true — always store timestamps in UTC (timezone-aware)
    // This is critical for a global app — never store local time in a database
    table
      .timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp("updated_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  // Indexes — these make queries faster
  // Without indexes, PostgreSQL scans every row to find matches (slow)
  // With indexes, it jumps directly to matching rows (fast)

  // We query users by email on every login — needs an index
  await knex.raw("CREATE INDEX idx_users_email ON users(email)");

  // We query active users by role for permission checks
  await knex.raw(
    "CREATE INDEX idx_users_role ON users(role) WHERE is_active = true",
  );

  console.log("✓ Created users table");
}

export async function down(knex: Knex): Promise<void> {
  // Drop indexes first, then the table
  // 'down' must perfectly reverse everything 'up' did
  await knex.schema.dropTableIfExists("users");
  console.log("✓ Dropped users table");
}
