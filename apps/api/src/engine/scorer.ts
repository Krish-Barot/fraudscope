// apps/api/src/engine/scorer.ts
// Fraud evaluation engine — two responsibilities:
//
// 1. evaluate() — pure function, runs rules, returns composite score
//    Used by: worker (via evaluateAndProcess), rules API stats, tests
//
// 2. evaluateAndProcess() — evaluate + handle result
//    Used by: worker only
//    If score >= 20: writes to PostgreSQL (transaction), publishes to Redis
//    If score < 20:  marks transaction as processed, no alert created
//
// POSTGRESQL TRANSACTION GUARANTEE:
// Alert generation uses a DB transaction wrapping 4 operations:
//   UPDATE transactions → INSERT alerts → INSERT alert_rules → INSERT audit_logs
// If ANY of these fails, the entire transaction rolls back.
// This ensures we never have:
//   - A flagged transaction with no alert
//   - An alert with no triggered rules
//   - A missing audit log entry
// Atomicity is critical for compliance — every state change must be traceable.
//
// PUBSUB AFTER COMMIT:
// We publish to Redis AFTER the DB transaction commits.
// If we published before commit and the commit failed, the dashboard
// would show an alert that doesn't exist in the database.
// Publish-after-commit means: if you see it on the dashboard, it's in the DB.

import { db } from "../config/database";
import { redisClient, redisPublisher } from "../config/redis";
import { DbRule, TransactionData, RuleResult } from "./rules/types";

import * as velocityRule from "./rules/velocity";
import * as amountAnomalyRule from "./rules/amountAnomaly";
import * as geoMismatchRule from "./rules/geoMismatch";
import * as timeAnomalyRule from "./rules/timeAnomaly";
import * as roundAmountRule from "./rules/roundAmount";

// Registry maps DB rule type strings to implementation modules
// Adding a new rule: implement the module, add one line here
const RULE_REGISTRY: Record<
  string,
  { evaluate: Function; parameterSchema: any }
> = {
  velocity: velocityRule,
  amount_anomaly: amountAnomalyRule,
  geo_mismatch: geoMismatchRule,
  time_anomaly: timeAnomalyRule,
  round_amount: roundAmountRule,
};

// ─────────────────────────────────────────
// Redis channels
// ─────────────────────────────────────────
const ALERTS_PUBSUB_CHANNEL = "alerts:new";

// ─────────────────────────────────────────
// In-memory rule cache
// Rules are loaded from PostgreSQL once and cached for 60 seconds
// Changes made via the rules API take effect within one cache TTL
// ─────────────────────────────────────────
let cachedRules: DbRule[] = [];
let cacheLastRefreshed: number = 0;
const CACHE_TTL_MS = 60 * 1000;

async function getActiveRules(): Promise<DbRule[]> {
  const now = Date.now();

  if (cachedRules.length > 0 && now - cacheLastRefreshed < CACHE_TTL_MS) {
    return cachedRules;
  }

  const rules = await db("rules")
    .where("is_active", true)
    .select("id", "name", "type", "parameters", "severity", "score_weight");

  cachedRules = rules.map((rule: any) => ({
    ...rule,
    parameters:
      typeof rule.parameters === "string"
        ? JSON.parse(rule.parameters)
        : rule.parameters,
  }));

  cacheLastRefreshed = now;
  console.log(
    `✅ Rule cache refreshed — ${cachedRules.length} active rules loaded`,
  );

  return cachedRules;
}

export function invalidateRuleCache(): void {
  cacheLastRefreshed = 0;
  console.log("Rule cache invalidated — will reload on next transaction");
}

// ─────────────────────────────────────────
// Score to severity mapping
// ─────────────────────────────────────────
export function scoreToSeverity(score: number): string | null {
  if (score < 20) return null;
  if (score < 40) return "low";
  if (score < 60) return "medium";
  if (score < 80) return "high";
  return "critical";
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
// Pure evaluation — runs all active rules in parallel
// Returns score + triggered rules without any side effects
// No database writes, no Redis publishes
// ─────────────────────────────────────────
export async function evaluate(
  transaction: TransactionData,
): Promise<ScorerResult> {
  // Normalize amount — PostgreSQL DECIMAL comes back as string from Knex
  const normalizedTransaction: TransactionData = {
    ...transaction,
    amount:
      typeof transaction.amount === "string"
        ? parseFloat(transaction.amount as unknown as string)
        : transaction.amount,
  };

  const rules = await getActiveRules();
  if (rules.length === 0) {
    return { score: 0, severity: null, triggeredRules: [] };
  }

  const rulePromises = rules.map(async (rule) => {

    try {
      const ruleModule = RULE_REGISTRY[rule.type];
      if (!ruleModule) {
        throw new Error(`Unknown rule type: ${rule.type}`);
      }

      const result: RuleResult = await ruleModule.evaluate(
        normalizedTransaction, // ← changed
        rule.parameters,
        { redis: redisClient, db, severity: rule.severity },
      );

      if (result.triggered) {
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          ruleType: rule.type,
          scoreContribution: result.score,
          details: result.details,
        } as TriggeredRule;
      }

      return null;
    } catch (error) {
      // One rule failing never stops the others
      console.error(
        `Rule '${rule.name}' (${rule.type}) threw an error:`,
        (error as Error).message,
      );
      return null;
    }
  });

  const results = await Promise.all(rulePromises);
  const triggeredRules = results.filter((r): r is TriggeredRule => r !== null);

  // Sum contributions, cap at 100
  const rawScore = triggeredRules.reduce(
    (sum, r) => sum + r.scoreContribution,
    0,
  );
  const score = Math.min(rawScore, 100);
  const severity = scoreToSeverity(score);

  return { score, severity, triggeredRules };
}

// ─────────────────────────────────────────
// Alert generation — writes to PostgreSQL inside a transaction
// Called when score >= 20
//
// ─────────────────────────────────────────
// Operations (all-or-nothing):
// 1. UPDATE transactions  SET status='flagged', processed_at=NOW()
// 2. INSERT alerts         → get new alert UUID
// 3. INSERT alert_rules    → one row per triggered rule
// 4. INSERT audit_logs     → immutable event record
// 5. COMMIT
// Then: PUBLISH to Redis PubSub (after commit — see module header note)
// ─────────────────────────────────────────
async function generateAlert(
  transaction: TransactionData,
  score: number,
  severity: string,
  triggeredRules: TriggeredRule[],
): Promise<string> {
  // returns the new alert ID

  let alertId: string;

  // db.transaction() wraps everything in BEGIN/COMMIT
  // If any operation throws, Knex automatically rolls back (ROLLBACK)
  // and re-throws the error so the caller knows it failed
  await db.transaction(async (trx) => {
    // ── Idempotency Check: Return existing alert if already created ────
    const existing = await trx("alerts")
      .where({ transaction_id: transaction.id })
      .first();

    if (existing) {
      alertId = existing.id;
      return;
    }

    // ── Step 1: Mark transaction as flagged ───────────────────────
    await trx("transactions").where({ id: transaction.id }).update({
      status: "flagged",
      processed_at: trx.fn.now(),
    });

    // ── Step 2: Create the alert record ───────────────────────────
    const [alert] = await trx("alerts")
      .insert({
        transaction_id: transaction.id,
        risk_score: score,
        severity,
        status: "new",
      })
      .returning("*");

    alertId = alert.id;

    // ── Step 3: Insert one alert_rules row per triggered rule ──────
    // This is the "why was this flagged" data — stores each rule's
    // individual contribution and explanation for the alert detail page
    if (triggeredRules.length > 0) {
      await trx("alert_rules").insert(
        triggeredRules.map((rule) => ({
          alert_id: alertId,
          rule_id: rule.ruleId,
          // score_contribution: how many points this rule added
          score_contribution: rule.scoreContribution,
          // details: JSONB payload explaining why this rule fired
          // e.g. { current_count: 8, threshold: 5, message: "..." }
          details: JSON.stringify(rule.details),
        })),
      );
    }

    // ── Step 4: Write to audit_logs ───────────────────────────────
    // Immutable event record — cannot be deleted or modified
    // Required for compliance: every state change must be traceable
    await trx("audit_logs").insert({
      event_type: "alert.generated",
      actor_type: "system", // engine, not a human analyst
      target_type: "transaction",
      target_id: transaction.id,
      payload: JSON.stringify({
        alert_id: alertId,
        risk_score: score,
        severity,
        triggered_rules: triggeredRules.map((r) => ({
          type: r.ruleType,
          name: r.ruleName,
          score_contribution: r.scoreContribution,
        })),
      }),
      source: "engine",
    });

    // db.transaction() auto-commits here if no error was thrown
    // If any step above threw, it auto-rolled back instead
  });

  // ── Step 5: Publish to Redis PubSub ───────────────────────────
  // This happens OUTSIDE the DB transaction (after commit)
  // Reason: if publish failed but the transaction was still open,
  // rolling back would lose the alert. By publishing after commit,
  // the worst case is: alert exists in DB but dashboard doesn't
  // show it immediately. On next page refresh it will appear.
  // The reverse (dashboard shows alert that doesn't exist in DB)
  // would be far more confusing for analysts.
  await redisPublisher.publish(
    ALERTS_PUBSUB_CHANNEL,
    JSON.stringify({
      id: alertId!,
      transaction_id: transaction.id,
      risk_score: score,
      severity,
      status: "new",
      triggered_rules: triggeredRules.map((r) => ({
        type: r.ruleType,
        name: r.ruleName,
        score_contribution: r.scoreContribution,
      })),
      transaction: {
        account_id: transaction.account_id,
        amount: transaction.amount,
        currency: transaction.currency,
        country_code: transaction.country_code,
        channel: transaction.channel,
      },
      created_at: new Date().toISOString(),
    }),
  );

  return alertId!;
}

// ─────────────────────────────────────────
// Mark a clean transaction as processed
// Called when score < 20 — no alert, but we still need to update
// processed_at so we know the engine evaluated this transaction
// ─────────────────────────────────────────
async function markProcessed(transactionId: string): Promise<void> {
  await db("transactions")
    .where({ id: transactionId })
    .update({ processed_at: db.fn.now() });
}

// ─────────────────────────────────────────
// Main entry point for the worker
// Evaluates and handles the result in one call
// Returns the full result so the worker can log it
// ─────────────────────────────────────────
export interface ProcessResult {
  score: number;
  severity: string | null;
  alertId: string | null; // null if score < 20
  triggeredRules: TriggeredRule[];
}

export async function evaluateAndProcess(
  transaction: TransactionData,
): Promise<ProcessResult> {
  // Ensure amount is always a number — Knex returns DECIMAL as string
  const normalizedTransaction: TransactionData = {
    ...transaction,
    amount:
      typeof transaction.amount === "string"
        ? parseFloat(transaction.amount)
        : transaction.amount,
  };

  // Idempotency: check if an alert already exists for this transaction
  const existingAlert = await db("alerts")
    .where({ transaction_id: normalizedTransaction.id })
    .first();

  if (existingAlert) {
    return {
      score: existingAlert.risk_score,
      severity: existingAlert.severity,
      alertId: existingAlert.id,
      triggeredRules: [],
    };
  }

  // Idempotency: check if transaction was already marked clean and processed
  const txRecord = await db("transactions")
    .where({ id: normalizedTransaction.id })
    .first();

  if (txRecord?.processed_at && txRecord.status === "clean") {
    return { score: 0, severity: null, alertId: null, triggeredRules: [] };
  }

  const { score, severity, triggeredRules } = await evaluate(
    normalizedTransaction,
  );

  if (score >= 20 && severity) {
    const alertId = await generateAlert(
      normalizedTransaction,
      score,
      severity,
      triggeredRules,
    );
    return { score, severity, alertId, triggeredRules };
  } else {
    await markProcessed(normalizedTransaction.id);
    return { score, severity: null, alertId: null, triggeredRules: [] };
  }
}
