// apps/api/src/engine/rules/velocity.ts
// Velocity check — flags accounts making too many transactions in a short window
//
// ALGORITHM:
// 1. On each transaction for account X, increment Redis key velocity:{account_id}
// 2. On first increment (count === 1), set TTL = window_minutes * 60 seconds
// 3. If count > max_count → rule triggers
//
// WHY REDIS INCR NOT POSTGRESQL COUNT:
// A COUNT query on transactions requires scanning potentially thousands of rows
// and involves network round-trips to PostgreSQL.
// Redis INCR is O(1) — single in-memory operation taking microseconds.
// For a rule running on every transaction, this matters at scale.
//
// WHY SET EXPIRE ONLY ON FIRST INCREMENT:
// If we set TTL on every increment, each new transaction would reset the window.
// Account making 100 transactions/hour would never expire.
// Setting TTL only when count === 1 means the window starts at the FIRST
// transaction and expires exactly window_minutes later, regardless of how
// many transactions follow. This is the correct sliding window behaviour.
//
// ATOMICITY:
// Redis INCR is atomic. Even with multiple worker instances processing
// transactions for the same account simultaneously, the counter is always
// accurate — no race conditions.

import { z } from 'zod';
import { TransactionData, RuleContext, RuleResult, severityToScore } from './types';

// Parameter schema — validated by the scorer before calling evaluate()
// This prevents a misconfigured rule from crashing the engine
export const parameterSchema = z.object({
  max_count: z
    .number()
    .int('max_count must be an integer')
    .min(1, 'max_count must be at least 1')
    .max(100, 'max_count must be at most 100'),

  window_minutes: z
    .number()
    .int('window_minutes must be an integer')
    .min(1, 'window_minutes must be at least 1 minute')
    .max(1440, 'window_minutes must be at most 1440 (24 hours)'),
});

export type VelocityParameters = z.infer<typeof parameterSchema>;

export async function evaluate(
  transaction: TransactionData,
  parameters: Record<string, unknown>,
  context: RuleContext
): Promise<RuleResult> {
  // Validate parameters — throws ZodError if misconfigured
  // The scorer catches this and skips the rule rather than crashing
  const params = parameterSchema.parse(parameters);
  const { max_count, window_minutes } = params;

  // Redis key — namespaced to avoid collisions with other data
  // One key per account, shared across all velocity rule instances
  const key = `velocity:${transaction.account_id}`;
  const ttlSeconds = window_minutes * 60;

  // INCR atomically increments and returns the new value
  // If the key doesn't exist, Redis initialises it to 0 then increments → 1
  const count = await context.redis.incr(key);

  // Set expiry ONLY on the first increment
  // This starts the time window at the first transaction
  // Subsequent transactions within the window don't reset the timer
  if (count === 1) {
    await context.redis.expire(key, ttlSeconds);
  }

  // Rule triggers when count EXCEEDS max_count
  // e.g. max_count=5 → triggers on the 6th transaction (count=6)
  // Does NOT trigger on the 5th (count=5 is still within limit)
  const triggered = count > max_count;

  // Score is fixed based on rule severity configured in the database
  // high severity rule → 25 points, medium → 20, low → 15
  const score = triggered ? severityToScore(context.severity) : 0;

  return {
    triggered,
    score,
    details: {
      rule_type: 'velocity',
      current_count: count,
      threshold: max_count,
      window_minutes,
      // Human-readable message for the alert detail page
      // null when rule didn't trigger (cleaner than empty string)
      message: triggered
        ? `${count} transactions in ${window_minutes} min — threshold is ${max_count}`
        : null,
    },
  };
}