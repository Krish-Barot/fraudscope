// apps/api/seeds/02_rules.ts
// Seeds 5 detection rules — one per type
// These are the default rules the engine uses to evaluate transactions
// Parameters are tuned to catch obvious fraud without too many false positives

import { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  const existing = await knex('rules').select('id').limit(1);
  if (existing.length > 0) {
    console.log('  Rules already seeded — skipping');
    return;
  }

  await knex('rules').insert([
    {
      name: 'High Velocity',
      description: 'Flags accounts making too many transactions in a short window. '
        + 'Legitimate users rarely make more than 5 transactions in 10 minutes.',
      type: 'velocity',
      // parameters stored as JSONB — PostgreSQL stores this as binary JSON
      // knex automatically serializes the object to JSON string
      parameters: JSON.stringify({
        max_count: 5,
        window_minutes: 10,
      }),
      severity: 'high',
      score_weight: 25,
      is_active: true,
    },
    {
      name: 'Unusual Amount',
      description: 'Flags transactions significantly larger than the account\'s '
        + '30-day average. A $5,000 charge on an account that typically spends $50 is suspicious.',
      type: 'amount_anomaly',
      parameters: JSON.stringify({
        multiplier: 3.0,      // flag if amount > (30d average × 3)
        min_amount: 500,      // ignore small transactions even if they're 3x average
      }),
      severity: 'high',
      score_weight: 30,
      is_active: true,
    },
    {
      name: 'Geographic Mismatch',
      description: 'Flags transactions from a country the account has never '
        + 'transacted from before. Most people shop in their home country.',
      type: 'geo_mismatch',
      parameters: JSON.stringify({
        lookback_count: 5,           // check last 5 transactions for known countries
        alert_on_new_country: true,
      }),
      severity: 'medium',
      score_weight: 20,
      is_active: true,
    },
    {
      name: 'Odd Hours',
      description: 'Flags transactions between 2 AM and 5 AM local time. '
        + 'Legitimate purchases rarely happen in the early hours.',
      type: 'time_anomaly',
      parameters: JSON.stringify({
        suspicious_start_hour: 2,    // 2 AM
        suspicious_end_hour: 5,      // 5 AM
        timezone: 'America/Toronto',
      }),
      severity: 'low',
      score_weight: 15,
      is_active: true,
    },
    {
      name: 'Round Amount',
      description: 'Flags suspiciously round amounts above $1,000. '
        + 'Real purchases are rarely exactly $2,000 or $5,000 — '
        + 'fraudsters often test with round numbers.',
      type: 'round_amount',
      parameters: JSON.stringify({
        min_amount: 1000,
        tolerance: 0,                // exact round numbers only (e.g. $2000.00)
      }),
      severity: 'low',
      score_weight: 15,
      is_active: true,
    },
  ]);

  console.log('  ✅ Seeded 5 detection rules');
}