"use strict";
// apps/api/src/simulator/patterns.ts
// Fraud pattern functions — each transforms a normal transaction
// into one that should trigger specific detection rules
//
// Design principle: each pattern is independent and composable.
// A transaction can have 1-3 patterns applied simultaneously,
// which tests composite risk scoring (multiple rules firing at once).
Object.defineProperty(exports, "__esModule", { value: true });
exports.HIGH_RISK_COUNTRIES = void 0;
exports.applyHighAmount = applyHighAmount;
exports.applyForeignCountry = applyForeignCountry;
exports.applyOddHour = applyOddHour;
exports.applyRoundAmount = applyRoundAmount;
exports.applyRapidFire = applyRapidFire;
exports.randomInt = randomInt;
// High-risk countries for geo_mismatch pattern
// These are countries that appear in fraud databases frequently
// The rule engine flags transactions from these countries
exports.HIGH_RISK_COUNTRIES = [
    { code: 'NG', city: 'Lagos', lat: 6.5244, lng: 3.3792 },
    { code: 'RU', city: 'Moscow', lat: 55.7558, lng: 37.6173 },
    { code: 'PH', city: 'Manila', lat: 14.5995, lng: 120.9842 },
    { code: 'RO', city: 'Bucharest', lat: 44.4268, lng: 26.1025 },
    { code: 'UA', city: 'Kyiv', lat: 50.4501, lng: 30.5234 },
];
// ─────────────────────────────────────────
// Pattern 1: HIGH AMOUNT
// Triggers: amount_anomaly rule
// A transaction 5-20x the account's typical maximum
// ─────────────────────────────────────────
function applyHighAmount(tx, accountMaxSpend) {
    const multiplier = 5 + Math.random() * 15; // 5x to 20x
    return {
        ...tx,
        amount: parseFloat((accountMaxSpend * multiplier).toFixed(2)),
    };
}
// ─────────────────────────────────────────
// Pattern 2: FOREIGN COUNTRY
// Triggers: geo_mismatch rule
// Moves the transaction to a high-risk country
// the account has never transacted from
// ─────────────────────────────────────────
function applyForeignCountry(tx) {
    const country = exports.HIGH_RISK_COUNTRIES[Math.floor(Math.random() * exports.HIGH_RISK_COUNTRIES.length)];
    return {
        ...tx,
        country_code: country.code,
        city: country.city,
        latitude: country.lat,
        longitude: country.lng,
        // IP from a foreign range (simplified for simulation)
        ip_address: `${randomInt(100, 200)}.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`,
    };
}
// ─────────────────────────────────────────
// Pattern 3: ODD HOUR
// Triggers: time_anomaly rule
// Sets the transaction timestamp to 2-4 AM
// The rule engine checks the hour in the account's timezone
// ─────────────────────────────────────────
function applyOddHour(tx) {
    const now = new Date();
    // Set hour to between 2 AM and 4 AM (suspicious window from our rule config)
    const oddHour = 2 + Math.floor(Math.random() * 2); // 2 or 3 AM
    const oddMinute = Math.floor(Math.random() * 60);
    const suspiciousTime = new Date(now);
    suspiciousTime.setHours(oddHour, oddMinute, 0, 0);
    return {
        ...tx,
        created_at: suspiciousTime,
    };
}
// ─────────────────────────────────────────
// Pattern 4: ROUND AMOUNT
// Triggers: round_amount rule
// Sets amount to an exact round number above $1,000
// Real purchases are almost never exactly $2,000 or $5,000
// ─────────────────────────────────────────
function applyRoundAmount(tx) {
    // Pick a round amount: $1,000 / $2,000 / $3,000 / $5,000 / $10,000
    const roundAmounts = [1000, 2000, 3000, 5000, 10000];
    const amount = roundAmounts[Math.floor(Math.random() * roundAmounts.length)];
    return {
        ...tx,
        amount,
    };
}
// ─────────────────────────────────────────
// Pattern 5: RAPID FIRE
// Triggers: velocity rule
// Returns multiple transactions for the same account
// to be sent in quick succession (within 2 minutes)
// This is why rapid_fire returns an ARRAY while others return one transaction
// ─────────────────────────────────────────
function applyRapidFire(tx, count) {
    const transactions = [];
    const baseTime = new Date();
    for (let i = 0; i < count; i++) {
        // Each transaction is a few seconds apart within a 2-minute window
        const offsetSeconds = i * Math.floor(120 / count);
        const txTime = new Date(baseTime.getTime() + offsetSeconds * 1000);
        transactions.push({
            ...tx,
            // Each needs a unique external_id
            external_id: `${tx.external_id}-burst-${i}`,
            created_at: txTime,
        });
    }
    return transactions;
}
// Helper — random integer between min and max inclusive
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
//# sourceMappingURL=patterns.js.map