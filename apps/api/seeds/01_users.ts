// apps/api/seeds/01_users.ts
// Seeds 2 users: one analyst, one admin
// These are the accounts you'll use to log into FraudScope dashboard

import { Knex } from "knex";
import bcrypt from "bcrypt";

export async function seed(knex: Knex): Promise<void> {
  // Check if users already exist — prevents duplicate seed errors
  // This makes seeds idempotent (safe to run multiple times)
  const existing = await knex("users").select("id").limit(1);
  if (existing.length > 0) {
    console.log("  Users already seeded — skipping");
    return;
  }

  // bcrypt.hash(password, saltRounds)
  // saltRounds: 10 is the standard — takes ~100ms which is fast enough for UX
  // but slow enough to make brute-force attacks impractical
  const SALT_ROUNDS = 10;
  const analystPasswordHash = await bcrypt.hash("analyst123", SALT_ROUNDS);
  const adminPasswordHash = await bcrypt.hash("admin123", SALT_ROUNDS);

  await knex("users").insert([
    {
      // No id needed — PostgreSQL generates UUID automatically via gen_random_uuid()
      email: "analyst@fraudscope.dev",
      password_hash: analystPasswordHash,
      first_name: "Sarah",
      last_name: "Chen",
      role: "analyst",
      is_active: true,
    },
    {
      email: "admin@fraudscope.dev",
      password_hash: adminPasswordHash,
      first_name: "Marcus",
      last_name: "Webb",
      role: "admin",
      is_active: true,
    },
  ]);

  console.log(
    "  ✅ Seeded 2 users (analyst@fraudscope.dev, admin@fraudscope.dev)",
  );
  console.log(
    "  Passwords: analyst123 / admin123 (dev only)",
  );
}
