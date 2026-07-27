"use strict";
// apps/api/src/engine/rules/amountAnomaly.ts
// Amount anomaly — flags transactions significantly above the account's
// 30-day rolling average spend
//
// WHY THIS CATCHES FRAUD:
// Fraudsters who steal card details often make one large purchase quickly.
// If account ACC-0042 typically spends $30-$80 per transaction and suddenly
// a $4,500 charge appears, that's a strong fraud signal.
//
// CACHE-ASIDE PATTERN:
// Computing AVG(amount) over 30 days of transactions requires a table scan
// across potentially thousands of rows — expensive if done on every transaction.
// We cache the result in Redis for 1 hour. The tradeoff:
//   Pro: eliminates 99%+ of PostgreSQL queries for this rule
//   Con: a new large legitimate purchase updates the average after 1 hour delay
// This is acceptable — averages don't change meaningfully in 1 hour.
//
// EXCLUDING CURRENT TRANSACTION:
// The transaction being evaluated is already in PostgreSQL (the API inserts
// it before pushing to the Redis Stream). If we include it in the average,
// a legitimately large transaction would inflate its own baseline,
// reducing the rule's sensitivity. We exclude it with WHERE id != $1.
//
// SKIPPING NEW ACCOUNTS:
// An account with no 30-day history has no baseline to compare against.
// Flagging every first transaction would produce 100% false positives.
// We skip the rule and let other rules (velocity, geo_mismatch) catch fraud.
Object.defineProperty(exports, "__esModule", { value: true });
exports.parameterSchema = void 0;
exports.evaluate = evaluate;
const zod_1 = require("zod");
const types_1 = require("./types");
exports.parameterSchema = zod_1.z.object({
    multiplier: zod_1.z
        .number()
        .min(1.5, "multiplier must be at least 1.5")
        .max(20, "multiplier must be at most 20"),
    min_amount: zod_1.z.number().min(0, "min_amount cannot be negative"),
});
// Redis cache key — one entry per account
// 1-hour TTL balances freshness vs PostgreSQL load
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour
async function evaluate(transaction, parameters, context) {
    const params = exports.parameterSchema.parse(parameters);
    const { multiplier, min_amount } = params;
    // ── Early exit: skip small transactions ───────────────────────
    // Even if 3x the average, a $15 charge is not worth alerting on.
    // min_amount filters out noise from low-value accounts.
    if (transaction.amount < min_amount) {
        return {
            triggered: false,
            score: 0,
            details: {
                rule_type: "amount_anomaly",
                skipped: "below_min_amount",
                transaction_amount: transaction.amount,
                min_amount,
            },
        };
    }
    // ── Step 1: Check Redis cache ─────────────────────────────────
    const cacheKey = `avg:${transaction.account_id}`;
    const cached = await context.redis.get(cacheKey);
    let accountAverage = null;
    if (cached !== null) {
        // Cache HIT — parse the stored string back to a number
        accountAverage = parseFloat(cached);
    }
    else {
        // ── Step 2: Cache MISS — query PostgreSQL ─────────────────
        // AVG() over the last 30 days for this account
        // Excludes the current transaction to avoid self-inflation
        const result = await context
            .db("transactions")
            .where("account_id", transaction.account_id)
            .where("created_at", ">=", context.db.raw("NOW() - INTERVAL '30 days'"))
            .whereNot("id", transaction.id) // exclude current transaction
            .where("status", "!=", "blocked") // exclude blocked transactions from baseline
            .avg("amount as avg")
            .first();
        if (result?.avg) {
            accountAverage = parseFloat(result.avg);
            // ── Step 3: Store in Redis cache ──────────────────────────
            // SET key value EX seconds
            await context.redis.set(cacheKey, accountAverage.toString(), "EX", CACHE_TTL_SECONDS);
        }
    }
    // ── Step 4: Skip if no history ────────────────────────────────
    // accountAverage is null when:
    //   - Account has no transactions in last 30 days
    //   - This is the account's first ever transaction
    // Can't detect anomalies without a baseline
    if (accountAverage === null || accountAverage <= 0) {
        return {
            triggered: false,
            score: 0,
            details: {
                rule_type: "amount_anomaly",
                skipped: "no_account_history",
                transaction_amount: transaction.amount,
            },
        };
    }
    // ── Step 5: Evaluate the rule ─────────────────────────────────
    // Threshold = what the amount would need to exceed to trigger
    const threshold = accountAverage * multiplier;
    // BOTH conditions must be true:
    // 1. Amount exceeds the threshold (amount > avg * multiplier)
    // 2. Amount exceeds min_amount (already checked above, but double-check)
    const triggered = transaction.amount > threshold && transaction.amount > min_amount;
    // Ratio shows HOW anomalous the transaction is
    // ratio=4.0 means 4x the average (more suspicious than ratio=1.8)
    const ratio = transaction.amount / accountAverage;
    // Score from severity — 30 for critical, 25 for high, 20 for medium
    const score = triggered ? (0, types_1.severityToScore)(context.severity) : 0;
    return {
        triggered,
        score,
        details: {
            rule_type: "amount_anomaly",
            transaction_amount: transaction.amount,
            account_avg: Math.round(accountAverage * 100) / 100,
            multiplier,
            threshold_amount: Math.round(threshold * 100) / 100,
            ratio: Math.round(ratio * 100) / 100,
            cache_hit: cached !== null,
            message: triggered
                ? `$${transaction.amount} is ${ratio.toFixed(1)}x the 30-day average of $${accountAverage.toFixed(2)} (threshold: $${threshold.toFixed(2)})`
                : null,
        },
    };
}
//# sourceMappingURL=amountAnomaly.js.map