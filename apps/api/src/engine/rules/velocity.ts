// apps/api/src/engine/rules/velocity.ts
// Velocity check — flags accounts making too many transactions in a short window
//
// How it works:
// Every time a transaction comes in for account X, we increment a Redis counter
// for that account with a TTL equal to the window. If the counter exceeds
// max_count within the window, the rule triggers.
//
// Why Redis INCR (not PostgreSQL COUNT)?
// PostgreSQL query for recent tx count would require a table scan.
// Redis INCR is O(1) — microseconds. For a rule that runs on every transaction,
// this performance difference matters enormously at scale.
//
// Atomicity: Redis INCR is atomic — even with 10 workers running in parallel,
// each incrementing for the same account, the count is always accurate.

import { z } from 'zod';
import { RuleEvaluator, RuleResult, TransactionData, RuleContext } from './types';

export const parameterSchema = z.object({
  max_count: z.number().int().min(1).max(100),
  window_minutes: z.number().int().min(1).max(1440),
});

export async function evaluate(
  transaction: TransactionData,
  parameters: Record<string, unknown>,
  context: RuleContext
): Promise<RuleResult> {
  const params = parameterSchema.parse(parameters);
  const { max_count, window_minutes } = params;

  // Redis key — unique per account
  // Using a prefix so keys don't collide with other Redis data
  const key = `velocity:${transaction.account_id}`;
  const ttlSeconds = window_minutes * 60;

  // INCR atomically increments the counter and returns the new value
  // If the key doesn't exist, Redis creates it with value 0 first, then increments to 1
  const count = await context.redis.incr(key);

  // Set expiry only on first increment (count === 1)
  // If we set TTL on every increment, the window would keep extending
  // and the counter would never expire — defeating the purpose
  if (count === 1) {
    await context.redis.expire(key, ttlSeconds);
  }

  const triggered = count > max_count;

  return {
    triggered,
    // Score scales with severity of violation
    // A count of 10 when max is 5 is worse than 6 when max is 5
    score: triggered
      ? Math.min(25 + Math.floor((count - max_count) * 2), 35)
      : 0,
    details: {
      rule_type: 'velocity',
      current_count: count,
      threshold: max_count,
      window_minutes,
      message: triggered
        ? `${count} transactions in ${window_minutes} min (threshold: ${max_count})`
        : null,
    },
  };
}