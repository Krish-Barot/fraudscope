// apps/api/seeds/03_transactions.ts
// Seeds 1,000 historical transactions across 100 mock accounts
// Spread over the last 30 days so amount_anomaly has baseline data
//
// Why this matters: the amount_anomaly rule calculates a 30-day rolling average.
// Without history, every account's average is NULL and the rule skips them.
// With 30 days of history, Day 1 of real usage immediately has baselines to compare against.

import { Knex } from "knex";
import { v4 as uuidv4 } from "uuid";

// ─────────────────────────────────────────
// Mock data pools
// ─────────────────────────────────────────

const MERCHANTS = [
  "Tim Hortons",
  "Shoppers Drug Mart",
  "Loblaws",
  "Canadian Tire",
  "Metro",
  "LCBO",
  "Sport Chek",
  "Best Buy",
  "Amazon",
  "Uber",
  "Netflix",
  "Apple",
  "Steam",
  "Spotify",
  "Instacart",
];

const CHANNELS = ["online", "pos", "atm", "mobile", "wire"] as const;

// Channel weights — most transactions are POS or online
const CHANNEL_WEIGHTS = [0.35, 0.3, 0.1, 0.2, 0.05];

// Countries — mostly Canadian transactions with some US and UK
const HOME_COUNTRIES = ["CA", "CA", "CA", "CA", "US", "US", "GB"];

// ─────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────

// Returns a random number between min and max (inclusive)
function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

// Returns a random integer between min and max (inclusive)
function randomIntBetween(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

// Picks a random item from an array
function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Picks a weighted random item
// weights must sum to 1.0
function weightedRandom<T>(items: T[], weights: number[]): T {
  const rand = Math.random();
  let cumulative = 0;
  for (let i = 0; i < items.length; i++) {
    cumulative += weights[i];
    if (rand < cumulative) return items[i];
  }
  return items[items.length - 1];
}

// Returns a date between daysAgo days ago and now
// Used to spread transactions across the last 30 days
function randomDateInPast(daysAgo: number): Date {
  const now = Date.now();
  const past = now - daysAgo * 24 * 60 * 60 * 1000;
  return new Date(past + Math.random() * (now - past));
}

// Round to 2 decimal places (money formatting)
function toMoney(amount: number): string {
  return parseFloat(amount.toFixed(2)).toString();
}

// ─────────────────────────────────────────
// Account profile generator
// Each account has a "personality" — typical spend range and home country
// This makes the amount_anomaly rule meaningful because each account
// has a consistent baseline that anomalies stand out against
// ─────────────────────────────────────────

interface AccountProfile {
  id: string; // ACC-0001 through ACC-0100
  country: string;
  minSpend: number; // typical minimum transaction amount
  maxSpend: number; // typical maximum transaction amount
}

function generateAccounts(count: number): AccountProfile[] {
  const accounts: AccountProfile[] = [];

  for (let i = 1; i <= count; i++) {
    const id = `ACC-${String(i).padStart(4, "0")}`;
    const country = randomFrom(HOME_COUNTRIES);

    // Spend tier distribution
    // 40% low spenders ($5-$50), 35% medium ($20-$200),
    // 20% high ($100-$2000), 5% premium ($500-$10000)
    const tierRoll = Math.random();
    let minSpend: number;
    let maxSpend: number;

    if (tierRoll < 0.4) {
      minSpend = 5;
      maxSpend = 50;
    } else if (tierRoll < 0.75) {
      minSpend = 20;
      maxSpend = 200;
    } else if (tierRoll < 0.95) {
      minSpend = 100;
      maxSpend = 2000;
    } else {
      minSpend = 500;
      maxSpend = 10000;
    }

    accounts.push({ id, country, minSpend, maxSpend });
  }

  return accounts;
}

// ─────────────────────────────────────────
// Main seed function
// ─────────────────────────────────────────

export async function seed(knex: Knex): Promise<void> {
  const existing = await knex("transactions").select("id").limit(1);
  if (existing.length > 0) {
    console.log("  Transactions already seeded — skipping");
    return;
  }

  const accounts = generateAccounts(100);
  const transactions = [];

  // Distribute 1000 transactions across 100 accounts
  // Each account gets ~10 transactions on average
  // Some get more, some get fewer (realistic distribution)
  for (let i = 0; i < 1000; i++) {
    const account = accounts[i % 100]; // cycle through accounts evenly

    const amount = randomBetween(account.minSpend, account.maxSpend);
    const createdAt = randomDateInPast(30); // spread across last 30 days

    transactions.push({
      // external_id: unique identifier from source system
      // Using timestamp + random suffix to guarantee uniqueness
      external_id: `HIST-${Date.now()}-${uuidv4().slice(0, 8)}`,
      account_id: account.id,
      amount: toMoney(amount),
      currency:
        account.country === "GB"
          ? "GBP"
          : account.country === "US"
            ? "USD"
            : "CAD",
      merchant_name: randomFrom(MERCHANTS),
      merchant_category: "retail",
      country_code: account.country,
      channel: weightedRandom([...CHANNELS], CHANNEL_WEIGHTS),
      status: "clean", // all historical data is clean (pre-fraud-detection era)
      created_at: createdAt,
      processed_at: createdAt,
    });
  }

  // Insert in batches of 100
  // Inserting 1000 rows in one query can cause timeout issues
  // Batching keeps each query small and fast
  const BATCH_SIZE = 100;
  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE);
    await knex("transactions").insert(batch);
    console.log(
      `  Inserted transactions ${i + 1}–${Math.min(i + BATCH_SIZE, transactions.length)}`,
    );
  }

  console.log(`  ✅ Seeded 1,000 historical transactions across 100 accounts`);
  console.log(
    `  Amount anomaly rule now has 30-day baselines for all accounts`,
  );
}
