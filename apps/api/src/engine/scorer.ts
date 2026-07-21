// apps/api/src/engine/scorer.ts
// Evaluates a transaction against all active fraud detection rules
// and returns a composite risk score
//
// THIS IS A STUB — full implementation in FS-10
// The worker calls this for every transaction it processes
// Returning score: 0 means nothing gets flagged until FS-10 is complete

export interface TransactionData {
  id: string;
  external_id: string;
  account_id: string;
  amount: number;
  currency: string;
  country_code: string;
  channel: string;
  created_at: string;
}

export interface ScorerResult {
  score: number;          // 0-100 composite risk score
  severity: string | null; // null if score < 20 (no alert)
  triggeredRules: Array<{
    ruleId: string;
    ruleName: string;
    ruleType: string;
    scoreContribution: number;
    details: Record<string, unknown>;
  }>;
}

// stub implementation — returns score 0 (clean) for all transactions
// FS-10 replaces this with real rule evaluation
export async function evaluate(
  transaction: TransactionData
): Promise<ScorerResult> {
  // TODO: FS-10 — load active rules from DB, run each rule's evaluate(),
  // compute composite score, return triggered rules with details
  return {
    score: 0,
    severity: null,
    triggeredRules: [],
  };
}

// Maps numeric score to severity label
// Used by both the scorer and the worker
export function scoreToSeverity(score: number): string | null {
  if (score < 20)  return null;       // not suspicious enough to alert
  if (score < 40)  return 'low';
  if (score < 60)  return 'medium';
  if (score < 80)  return 'high';
  return 'critical';
}