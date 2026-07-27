"use strict";
// apps/api/src/engine/rules/geoMismatch.ts
// Geographic mismatch — flags transactions from countries the account
// has not recently transacted from
//
// DATA STRUCTURE:
// Redis LIST key: geo:{account_id}:countries
// Contains the last lookback_count country codes, newest first
// Example: ['CA', 'CA', 'US', 'CA', 'GB']
//
// LPUSH + LTRIM PATTERN:
// LPUSH adds to the HEAD (newest first)
// LTRIM keeps only indices 0 to (lookback_count-1)
// Together they implement a fixed-size sliding window:
//   - New countries push old ones out automatically
//   - Memory usage is bounded regardless of account age
//   - O(1) insert, O(1) trim
//
// EVALUATION ORDER (important):
// 1. Read current country list from Redis (or PostgreSQL fallback)
// 2. Evaluate whether current transaction triggers the rule
// 3. THEN update the list with the current country
// Why this order? We evaluate BEFORE updating so the current transaction's
// country doesn't count as a "known" country for itself.
// If we updated first, every first-time country would never trigger.
//
// POSTGRESQL FALLBACK:
// On cache miss (Redis key doesn't exist), we query PostgreSQL for
// the last N transactions and build the Redis list from that data.
// This handles: worker restarts, Redis flushes, new deployments.
//
// HIGH-RISK SCORING:
// A new country is suspicious regardless of which country.
// But 'NG' or 'RU' gets a higher score than 'JP' or 'AU'
// because they appear more frequently in fraud databases.
Object.defineProperty(exports, "__esModule", { value: true });
exports.parameterSchema = void 0;
exports.evaluate = evaluate;
const zod_1 = require("zod");
const constants_1 = require("./constants");
exports.parameterSchema = zod_1.z.object({
    lookback_count: zod_1.z
        .number()
        .int('lookback_count must be an integer')
        .min(3, 'lookback_count must be at least 3')
        .max(20, 'lookback_count must be at most 20'),
    alert_on_new_country: zod_1.z
        .boolean({
        required_error: 'alert_on_new_country is required',
        invalid_type_error: 'alert_on_new_country must be a boolean',
    }),
});
async function evaluate(transaction, parameters, context) {
    const params = exports.parameterSchema.parse(parameters);
    const { lookback_count, alert_on_new_country } = params;
    // Rule is disabled via config — return immediately
    // Admin can toggle this off without removing the rule from DB
    if (!alert_on_new_country) {
        return {
            triggered: false,
            score: 0,
            details: {
                rule_type: 'geo_mismatch',
                skipped: 'alert_on_new_country_disabled',
            },
        };
    }
    const redisKey = `geo:${transaction.account_id}:countries`;
    // ── Step 1: Read current known countries ─────────────────────
    // LRANGE 0 -1 returns ALL items in the list (Redis uses -1 for end)
    let knownCountries = await context.redis.lrange(redisKey, 0, -1);
    // ── Step 2: PostgreSQL fallback on cache miss ─────────────────
    // Empty list means either: new account, Redis restart, or TTL expired
    if (knownCountries.length === 0) {
        const recentTxs = await context.db('transactions')
            .where('account_id', transaction.account_id)
            .whereNot('id', transaction.id) // exclude current transaction
            .orderBy('created_at', 'desc')
            .limit(lookback_count)
            .select('country_code');
        knownCountries = recentTxs.map((tx) => tx.country_code);
        // Populate Redis with the historical data so future transactions
        // don't need to fall back to PostgreSQL
        if (knownCountries.length > 0) {
            // Use a pipeline to send multiple commands in one round-trip
            // This is more efficient than separate RPUSH calls
            const pipeline = context.redis.pipeline();
            // RPUSH adds to the tail — knownCountries is already newest-first
            // from ORDER BY created_at DESC, but for the LIST we want
            // the most recent at index 0 (head), so we reverse before pushing
            const reversed = [...knownCountries].reverse();
            reversed.forEach(country => pipeline.rpush(redisKey, country));
            pipeline.ltrim(redisKey, 0, lookback_count - 1);
            pipeline.expire(redisKey, constants_1.GEO_CACHE_TTL_SECONDS);
            await pipeline.exec();
        }
    }
    // ── Guard: skip if truly no history exists ────────────────────
    // If both Redis and PostgreSQL returned empty (new account with
    // no prior transactions), we cannot determine if this country is
    // a mismatch. Skip to avoid false positives on new accounts.
    if (knownCountries.length === 0) {
        // Still update Redis with current country for future transactions
        await context.redis.lpush(redisKey, transaction.country_code);
        await context.redis.expire(redisKey, constants_1.GEO_CACHE_TTL_SECONDS);
        return {
            triggered: false,
            score: 0,
            details: {
                rule_type: 'geo_mismatch',
                skipped: 'no_account_history',
                current_country: transaction.country_code,
            },
        };
    }
    // ── Step 3: Evaluate the rule ─────────────────────────────────
    // Check if the current country is in the known countries list
    const knownCountriesSet = new Set(knownCountries);
    const isNewCountry = !knownCountriesSet.has(transaction.country_code);
    const isHighRisk = constants_1.HIGH_RISK_COUNTRIES.has(transaction.country_code);
    // Triggers ONLY when both conditions are true:
    // 1. Country has not been seen recently (isNewCountry)
    // 2. alert_on_new_country config is true (already checked above)
    const triggered = isNewCountry;
    // High-risk countries score higher than ordinary new countries
    const score = triggered
        ? (isHighRisk ? constants_1.GEO_SCORE_HIGH_RISK : constants_1.GEO_SCORE_UNKNOWN)
        : 0;
    // ── Step 4: Update the Redis list with current country ────────
    // IMPORTANT: this happens AFTER evaluation so the current country
    // doesn't count as "known" for this transaction's evaluation
    // (see "EVALUATION ORDER" note above)
    await context.redis.lpush(redisKey, transaction.country_code);
    // LTRIM keeps only the first lookback_count items (newest)
    // If list was ['CA', 'US'] and we pushed 'GB', list is now ['GB', 'CA', 'US']
    // LTRIM(0, lookback_count-1) keeps all of them if under limit,
    // or drops the tail (oldest) if over
    await context.redis.ltrim(redisKey, 0, lookback_count - 1);
    // Reset TTL on every transaction — the window stays alive as long
    // as the account is active
    await context.redis.expire(redisKey, constants_1.GEO_CACHE_TTL_SECONDS);
    return {
        triggered,
        score,
        details: {
            rule_type: 'geo_mismatch',
            current_country: transaction.country_code,
            known_countries: Array.from(knownCountriesSet),
            is_new_country: isNewCountry,
            is_high_risk_country: isHighRisk,
            lookback_count,
            message: triggered
                ? `Transaction from ${transaction.country_code}${isHighRisk ? ' (HIGH RISK)' : ''} — account history shows: ${Array.from(knownCountriesSet).join(', ')}`
                : null,
        },
    };
}
//# sourceMappingURL=geoMismatch.js.map