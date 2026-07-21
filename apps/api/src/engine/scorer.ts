// apps/api/src/engine/scorer.ts
// Evaluates a transaction against all active fraud detection rules
// Returns a composite risk score and list of triggered rules
//
// RULE CACHING:
// Loading rules from PostgreSQL on every transaction would be slow
// and would hammer the database. Rules change rarely (admins update them
// occasionally) so we cache them in memory for 60 seconds.
// If an admin toggles a rule off, the change takes effect within 60s.
//
// PARALLEL EVALUATION:
// All rules run simultaneously via Promise.all — not sequentially.
// If you have 5 rules and each takes 50ms, sequential = 250ms total.
// Parallel = ~50ms total (they all run at the same time).
// This is safe because rules are independent — they don't share state
// with each other (each rule uses its own Redis keys).

import { db } from '../config/database';
import { redisClient } from '../config/redis';
import { DbRule, TransactionData, RuleResult } from './rules/types';

// Import all rule evaluators
// Each module exports { evaluate, parameterSchema }
import * as velocityRule from './rules/velocity';
import * as amountAnomalyRule from './rules/amountAnomaly';
import * as geoMismatchRule from './rules/geoMismatch';
import * as timeAnomalyRule from './rules/timeAnomaly';
import * as roundAmountRule from './rules/roundAmount';

// Map rule type strings (stored in DB) to their implementation modules
// When you add a new rule type, add it here
const RULE_REGISTRY: Record<string, { evaluate: Function; parameterSchema: any }> = {
  velocity:       velocityRule,
  amount_anomaly: amountAnomalyRule,
  geo_mismatch:   geoMismatchRule,
  time_anomaly:   timeAnomalyRule,
  round_amount:   roundAmountRule,
};

// ─────────────────────────────────────────
// In-memory rule cache
// Avoids loading rules from PostgreSQL on every transaction
// ─────────────────────────────────────────
let cachedRules: DbRule[] = [];
let cacheLastRefreshed: number = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

async function getActiveRules(): Promise<DbRule[]> {
  const now = Date.now();

  // Return cached rules if still fresh
  if (cachedRules.length > 0 && (now - cacheLastRefreshed) < CACHE_TTL_MS) {
    return cachedRules;
  }

  // Cache stale or empty — reload from PostgreSQL
  const rules = await db('rules')
    .where('is_active', true)
    .select('id', 'name', 'type', 'parameters', 'severity', 'score_weight');

  cachedRules = rules.map((rule: any) => ({
    ...rule,
    // parameters is stored as JSONB — knex may return it as object or string
    parameters: typeof rule.parameters === 'string'
      ? JSON.parse(rule.parameters)
      : rule.parameters,
  }));

  cacheLastRefreshed = now;
  console.log(`✅ Rule cache refreshed — ${cachedRules.length} active rules loaded`);

  return cachedRules;
}

// Force cache refresh — called when admin toggles a rule
// (we'll wire this up in FS-17 rules API)
export function invalidateRuleCache(): void {
  cacheLastRefreshed = 0;
  console.log('Rule cache invalidated — will reload on next transaction');
}

// ─────────────────────────────────────────
// Score to severity mapping
// ─────────────────────────────────────────
export function scoreToSeverity(score: number): string | null {
  if (score < 20)  return null;
  if (score < 40)  return 'low';
  if (score < 60)  return 'medium';
  if (score < 80)  return 'high';
  return 'critical';
}

// ─────────────────────────────────────────
// Result types
// ─────────────────────────────────────────
export interface TriggeredRule {
  ruleId: string;
  ruleName: string;
  ruleType: string;
  scoreContribution: number;
  details: Record<string, unknown>;
}

export interface ScorerResult {
  score: number;
  severity: string | null;
  triggeredRules: TriggeredRule[];
}

// ─────────────────────────────────────────
// Main evaluate function
// Called by the worker for every transaction
// ─────────────────────────────────────────
export async function evaluate(transaction: TransactionData): Promise<ScorerResult> {
  const rules = await getActiveRules();

  if (rules.length === 0) {
    return { score: 0, severity: null, triggeredRules: [] };
  }

  // Shared context passed to every rule
  const context = { redis: redisClient, db };

  // Run ALL rules in parallel — each rule is independent
  // Promise.all waits for all to complete before continuing
  // If one rule throws, Promise.all rejects — we handle this below
  const rulePromises = rules.map(async (rule) => {
    const ruleModule = RULE_REGISTRY[rule.type];

    if (!ruleModule) {
      // Unknown rule type — this happens if a new rule type is in the DB
      // but hasn't been implemented yet. Skip it safely.
      console.warn(`Unknown rule type: ${rule.type} — skipping`);
      return null;
    }

    try {
      const result: RuleResult = await ruleModule.evaluate(
        transaction,
        rule.parameters,
        context
      );

      if (result.triggered) {
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          ruleType: rule.type,
          // Scale the raw rule score by the rule's weight
          // score_weight=25 means this rule contributes up to 25 points
          // score_weight=15 means a lower-priority rule
          scoreContribution: Math.round(
            (result.score / 25) * rule.score_weight
          ),
          details: result.details,
        } as TriggeredRule;
      }

      return null; // rule didn't trigger

    } catch (error) {
      // One rule failing should never stop other rules from running
      // Log the error and continue — better to miss one rule than crash
      console.error(
        `Rule '${rule.name}' (${rule.type}) threw an error:`,
        (error as Error).message
      );
      return null;
    }
  });

  // Wait for all rules to finish
  const results = await Promise.all(rulePromises);

  // Filter out null results (rules that didn't trigger or failed)
  const triggeredRules = results.filter(
    (r): r is TriggeredRule => r !== null
  );

  // Sum all score contributions, cap at 100
  const rawScore = triggeredRules.reduce(
    (sum, rule) => sum + rule.scoreContribution,
    0
  );
  const score = Math.min(rawScore, 100);
  const severity = scoreToSeverity(score);

  return { score, severity, triggeredRules };
}