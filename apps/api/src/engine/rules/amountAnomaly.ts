// apps/api/src/engine/rules/amountAnomaly.ts
// Amount anomaly — flags transactions significantly above account's 30-day average
//
// Why this catches fraud:
// Fraudsters who steal card details often test with small amounts first,
// then make one large purchase. The large purchase will be many times
// the account's typical spend and trigger this rule.
//
// Why cache the average in Redis?
// The PostgreSQL query to compute avg(amount) over 30 days for an account
// involves a table scan across potentially thousands of rows.
// We cache the result for 1 hour — the average barely changes in an hour
// and the cache miss cost (one slow query) happens rarely.

import { z } from 'zod';
import { RuleEvaluator, RuleResult, TransactionData, RuleContext } from './types';

export const parameterSchema = z.object({
  multiplier: z.number().min(1.5).max(20),
  min_amount: z.number().min(0),
});

export async function evaluate(
  transaction: TransactionData,
  parameters: Record<string, unknown>,
  context: RuleContext
): Promise<RuleResult> {
  const params = parameterSchema.parse(parameters);
  const { multiplier, min_amount } = params;

  // Skip small transactions — even if 3x the average, $15 isn't fraud-worthy
  if (transaction.amount < min_amount) {
    return { triggered: false, score: 0, details: { rule_type: 'amount_anomaly', skipped: 'below_min_amount' } };
  }

  // Check cache first
  const cacheKey = `avg:${transaction.account_id}`;
  const cached = await context.redis.get(cacheKey);

  let accountAverage: number | null = null;

  if (cached) {
    accountAverage = parseFloat(cached);
  } else {
    // Cache miss — query PostgreSQL for 30-day average
    const result = await context.db('transactions')
      .where('account_id', transaction.account_id)
      .where('created_at', '>=', context.db.raw("NOW() - INTERVAL '30 days'"))
      .whereNot('id', transaction.id) // exclude current transaction from average
      .avg('amount as avg')
      .first();

    if (result?.avg) {
      accountAverage = parseFloat(result.avg as string);
      // Cache for 1 hour — TTL in seconds
      await context.redis.set(cacheKey, accountAverage.toString(), 'EX', 3600);
    }
  }

  // No history — skip rule for new accounts
  // We can't flag anomalies without a baseline to compare against
  if (!accountAverage || accountAverage === 0) {
    return {
      triggered: false,
      score: 0,
      details: { rule_type: 'amount_anomaly', skipped: 'no_account_history' },
    };
  }

  const threshold = accountAverage * multiplier;
  const triggered = transaction.amount > threshold;

  // Score scales with how extreme the anomaly is
  // 3x average = lower score than 10x average
  const ratio = transaction.amount / accountAverage;
  const score = triggered
    ? Math.min(20 + Math.floor((ratio - multiplier) * 3), 30)
    : 0;

  return {
    triggered,
    score,
    details: {
      rule_type: 'amount_anomaly',
      transaction_amount: transaction.amount,
      account_average: Math.round(accountAverage * 100) / 100,
      multiplier,
      threshold: Math.round(threshold * 100) / 100,
      ratio: Math.round(ratio * 100) / 100,
      message: triggered
        ? `$${transaction.amount} is ${ratio.toFixed(1)}x the 30-day average of $${accountAverage.toFixed(2)}`
        : null,
    },
  };
}