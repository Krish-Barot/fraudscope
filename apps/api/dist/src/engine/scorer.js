"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateRuleCache = invalidateRuleCache;
exports.scoreToSeverity = scoreToSeverity;
exports.evaluate = evaluate;
exports.evaluateAndProcess = evaluateAndProcess;
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const velocityRule = __importStar(require("./rules/velocity"));
const amountAnomalyRule = __importStar(require("./rules/amountAnomaly"));
const geoMismatchRule = __importStar(require("./rules/geoMismatch"));
const timeAnomalyRule = __importStar(require("./rules/timeAnomaly"));
const roundAmountRule = __importStar(require("./rules/roundAmount"));
// Registry maps DB rule type strings to implementation modules
// Adding a new rule: implement the module, add one line here
const RULE_REGISTRY = {
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
let cachedRules = [];
let cacheLastRefreshed = 0;
const CACHE_TTL_MS = 60 * 1000;
async function getActiveRules() {
    const now = Date.now();
    if (cachedRules.length > 0 && now - cacheLastRefreshed < CACHE_TTL_MS) {
        return cachedRules;
    }
    const rules = await (0, database_1.db)("rules")
        .where("is_active", true)
        .select("id", "name", "type", "parameters", "severity", "score_weight");
    cachedRules = rules.map((rule) => ({
        ...rule,
        parameters: typeof rule.parameters === "string"
            ? JSON.parse(rule.parameters)
            : rule.parameters,
    }));
    cacheLastRefreshed = now;
    console.log(`✓ Rule cache refreshed — ${cachedRules.length} active rules loaded`);
    return cachedRules;
}
function invalidateRuleCache() {
    cacheLastRefreshed = 0;
    console.log("Rule cache invalidated — will reload on next transaction");
}
// ─────────────────────────────────────────
// Score to severity mapping
// ─────────────────────────────────────────
function scoreToSeverity(score) {
    if (score < 20)
        return null;
    if (score < 40)
        return "low";
    if (score < 60)
        return "medium";
    if (score < 80)
        return "high";
    return "critical";
}
// ─────────────────────────────────────────
// Pure evaluation — runs all active rules in parallel
// Returns score + triggered rules without any side effects
// No database writes, no Redis publishes
// ─────────────────────────────────────────
async function evaluate(transaction) {
    // Normalize amount — PostgreSQL DECIMAL comes back as string from Knex
    const normalizedTransaction = {
        ...transaction,
        amount: typeof transaction.amount === "string"
            ? parseFloat(transaction.amount)
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
            const result = await ruleModule.evaluate(normalizedTransaction, // ← changed
            rule.parameters, { redis: redis_1.redisClient, db: database_1.db, severity: rule.severity });
            if (result.triggered) {
                return {
                    ruleId: rule.id,
                    ruleName: rule.name,
                    ruleType: rule.type,
                    scoreContribution: result.score,
                    details: result.details,
                };
            }
            return null;
        }
        catch (error) {
            // One rule failing never stops the others
            console.error(`Rule '${rule.name}' (${rule.type}) threw an error:`, error.message);
            return null;
        }
    });
    const results = await Promise.all(rulePromises);
    const triggeredRules = results.filter((r) => r !== null);
    // Sum contributions, cap at 100
    const rawScore = triggeredRules.reduce((sum, r) => sum + r.scoreContribution, 0);
    const score = Math.min(rawScore, 100);
    const severity = scoreToSeverity(score);
    return { score, severity, triggeredRules };
}
// ─────────────────────────────────────────
// Alert generation — writes to PostgreSQL inside a transaction
// Called when score >= 20
//
// Operations (all-or-nothing):
// 1. UPDATE transactions  SET status='flagged', processed_at=NOW()
// 2. INSERT alerts         → get new alert UUID
// 3. INSERT alert_rules    → one row per triggered rule
// 4. INSERT audit_logs     → immutable event record
// 5. COMMIT
// Then: PUBLISH to Redis PubSub (after commit — see module header note)
// ─────────────────────────────────────────
async function generateAlert(transaction, score, severity, triggeredRules) {
    // returns the new alert ID
    let alertId;
    // db.transaction() wraps everything in BEGIN/COMMIT
    // If any operation throws, Knex automatically rolls back (ROLLBACK)
    // and re-throws the error so the caller knows it failed
    await database_1.db.transaction(async (trx) => {
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
            await trx("alert_rules").insert(triggeredRules.map((rule) => ({
                alert_id: alertId,
                rule_id: rule.ruleId,
                // score_contribution: how many points this rule added
                score_contribution: rule.scoreContribution,
                // details: JSONB payload explaining why this rule fired
                // e.g. { current_count: 8, threshold: 5, message: "..." }
                details: JSON.stringify(rule.details),
            })));
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
    await redis_1.redisPublisher.publish(ALERTS_PUBSUB_CHANNEL, JSON.stringify({
        id: alertId,
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
    }));
    return alertId;
}
// ─────────────────────────────────────────
// Mark a clean transaction as processed
// Called when score < 20 — no alert, but we still need to update
// processed_at so we know the engine evaluated this transaction
// ─────────────────────────────────────────
async function markProcessed(transactionId) {
    await (0, database_1.db)("transactions")
        .where({ id: transactionId })
        .update({ processed_at: database_1.db.fn.now() });
}
async function evaluateAndProcess(transaction) {
    // Ensure amount is always a number — Knex returns DECIMAL as string
    const normalizedTransaction = {
        ...transaction,
        amount: typeof transaction.amount === "string"
            ? parseFloat(transaction.amount)
            : transaction.amount,
    };
    const { score, severity, triggeredRules } = await evaluate(normalizedTransaction);
    if (score >= 20 && severity) {
        const alertId = await generateAlert(normalizedTransaction, score, severity, triggeredRules);
        return { score, severity, alertId, triggeredRules };
    }
    else {
        await markProcessed(normalizedTransaction.id);
        return { score, severity: null, alertId: null, triggeredRules: [] };
    }
}
//# sourceMappingURL=scorer.js.map