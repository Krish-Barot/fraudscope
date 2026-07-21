// apps/api/src/engine/rules/roundAmount.ts
// Round amount — flags suspiciously round amounts above a threshold
//
// Real purchases have specific prices: $47.83, $129.99, $23.50
// Fraudsters testing stolen cards often use round amounts: $1,000, $5,000
// because they're entering amounts manually or using automated scripts
// that default to round numbers.
//
// Also catches "structuring" — a fraud pattern where criminals make
// transactions just under reporting thresholds ($9,999 instead of $10,000)
// Those aren't perfectly round but are still suspicious at high amounts.

import { z } from 'zod';
import { RuleEvaluator, RuleResult, TransactionData, RuleContext } from './types';

export const parameterSchema = z.object({
  min_amount: z.number().min(0),
  tolerance: z.number().min(0).max(10).default(0),
});

export async function evaluate(
  transaction: TransactionData,
  parameters: Record<string, unknown>,
  _context: RuleContext
): Promise<RuleResult> {
  const params = parameterSchema.parse(parameters);
  const { min_amount, tolerance } = params;

  if (transaction.amount < min_amount) {
    return { triggered: false, score: 0, details: { rule_type: 'round_amount', skipped: 'below_min_amount' } };
  }

  // Check if amount is "round" within the tolerance
  // tolerance=0: only exact multiples of 100 ($1000, $2000, $5000)
  // tolerance=1: also catches near-round ($999, $1001)
  const remainder = transaction.amount % 100;
  const isRound = remainder <= tolerance || remainder >= (100 - tolerance);

  // Also flag exact multiples of 1000 and 500 (even stricter patterns)
  const isExactThousand = transaction.amount % 1000 === 0;
  const isExactFiveHundred = transaction.amount % 500 === 0;

  const triggered = isRound;

  // Higher amounts get higher scores
  let score = 0;
  if (triggered) {
    if (transaction.amount >= 10000) score = 25;
    else if (transaction.amount >= 5000) score = 20;
    else score = 15;

    // Bonus for extremely suspicious patterns
    if (isExactThousand) score = Math.min(score + 5, 30);
  }

  return {
    triggered,
    score,
    details: {
      rule_type: 'round_amount',
      amount: transaction.amount,
      min_amount,
      remainder: Math.round(remainder * 100) / 100,
      is_exact_thousand: isExactThousand,
      is_exact_five_hundred: isExactFiveHundred,
      message: triggered
        ? `Suspicious round amount: $${transaction.amount} (multiple of 100)`
        : null,
    },
  };
}