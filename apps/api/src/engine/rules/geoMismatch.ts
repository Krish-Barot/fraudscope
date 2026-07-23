// apps/api/src/engine/rules/geoMismatch.ts
// Geographic mismatch — flags transactions from countries
// the account has never used before
//
// How it works:
// We maintain a Redis LIST of the account's recent transaction countries.
// If the current transaction's country isn't in that list, it triggers.
//
// LPUSH + LTRIM pattern:
// LPUSH adds to the front of the list (newest first)
// LTRIM keeps only the last N items
// Together they create a fixed-size sliding window of recent countries
// that never grows beyond lookback_count

import { z } from "zod";
import { TransactionData, RuleContext, RuleResult, severityToScore } from './types';

// Countries frequently associated with card fraud
// Transactions from these trigger a higher score than unknown-but-not-high-risk countries
const HIGH_RISK_COUNTRIES = new Set([
  "NG",
  "RU",
  "KP",
  "IR",
  "VE",
  "BY",
  "PH",
  "RO",
  "UA",
]);

export const parameterSchema = z.object({
  lookback_count: z.number().int().min(3).max(20),
  alert_on_new_country: z.boolean(),
});

export async function evaluate(
  transaction: TransactionData,
  parameters: Record<string, unknown>,
  context: RuleContext,
): Promise<RuleResult> {
  const params = parameterSchema.parse(parameters);
  const { lookback_count, alert_on_new_country } = params;

  if (!alert_on_new_country) {
    return {
      triggered: false,
      score: 0,
      details: { rule_type: "geo_mismatch", skipped: "disabled" },
    };
  }

  const key = `geo:${transaction.account_id}:countries`;

  // Get the list of recent countries from Redis
  let recentCountries = await context.redis.lrange(key, 0, lookback_count - 1);

  // If no Redis data, fall back to PostgreSQL
  if (recentCountries.length === 0) {
    const recentTxs = await context
      .db("transactions")
      .where("account_id", transaction.account_id)
      .whereNot("id", transaction.id)
      .orderBy("created_at", "desc")
      .limit(lookback_count)
      .select("country_code");

    recentCountries = recentTxs.map(
      (tx: { country_code: string }) => tx.country_code,
    );

    // Populate Redis cache for next time
    if (recentCountries.length > 0) {
      const pipeline = context.redis.pipeline();
      recentCountries.forEach((country) => pipeline.rpush(key, country));
      pipeline.ltrim(key, 0, lookback_count - 1);
      pipeline.expire(key, 7 * 24 * 60 * 60); // 7 days
      await pipeline.exec();
    }
  }

  // Always update the list with the current transaction's country
  // LPUSH adds to front, LTRIM keeps only lookback_count items
  await context.redis.lpush(key, transaction.country_code);
  await context.redis.ltrim(key, 0, lookback_count - 1);
  await context.redis.expire(key, 7 * 24 * 60 * 60);

  // No history means this is the account's first transaction
  // Can't detect a mismatch without known countries
  if (recentCountries.length === 0) {
    return {
      triggered: false,
      score: 0,
      details: { rule_type: "geo_mismatch", skipped: "no_history" },
    };
  }

  const knownCountries = new Set(recentCountries);
  const isNewCountry = !knownCountries.has(transaction.country_code);
  const isHighRisk = HIGH_RISK_COUNTRIES.has(transaction.country_code);

  const triggered = isNewCountry;

  // High-risk countries get a significantly higher score
  const score = triggered
    ? isHighRisk
      ? severityToScore(context.severity) + 5
      : severityToScore(context.severity)
    : 0;

  return {
    triggered,
    score,
    details: {
      rule_type: "geo_mismatch",
      current_country: transaction.country_code,
      known_countries: Array.from(knownCountries),
      is_high_risk_country: isHighRisk,
      message: triggered
        ? `Transaction from ${transaction.country_code} — account history shows: ${Array.from(knownCountries).join(", ")}`
        : null,
    },
  };
}
