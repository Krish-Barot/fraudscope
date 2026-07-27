"use strict";
// apps/api/src/simulator/generator.ts
// Builds transaction objects from account profiles
// Applies fraud patterns when needed
// Returns either one transaction (normal/most fraud patterns)
// or multiple (rapid_fire pattern)
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateNormal = generateNormal;
exports.generateSuspicious = generateSuspicious;
const uuid_1 = require("uuid");
const patterns_1 = require("./patterns");
const MERCHANTS = [
    'Tim Hortons', 'Shoppers Drug Mart', 'Loblaws', 'Canadian Tire',
    'Metro', 'LCBO', 'Sport Chek', 'Best Buy', 'Amazon.ca', 'Uber',
    'Netflix', 'Apple Store', 'Steam', 'Spotify', 'Instacart',
    'Costco', 'IKEA', 'H&M', 'Zara', 'Whole Foods',
];
const CHANNELS = ['online', 'pos', 'pos', 'mobile', 'atm'];
// pos appears twice → ~40% chance (realistic distribution)
const FRAUD_PATTERNS = [
    'high_amount',
    'foreign_country',
    'odd_hour',
    'round_amount',
    'rapid_fire',
];
function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
function randomBetween(min, max) {
    return parseFloat((Math.random() * (max - min) + min).toFixed(2));
}
// Add small geographic jitter so not all transactions from the same account
// appear at exactly the same lat/lng (more realistic)
function jitter(value, range) {
    return parseFloat((value + (Math.random() - 0.5) * range).toFixed(7));
}
// Build a base normal transaction for an account
function buildBaseTransaction(account) {
    const amount = randomBetween(account.minSpend, account.maxSpend);
    return {
        external_id: `SIM-${Date.now()}-${(0, uuid_1.v4)().slice(0, 8)}`,
        account_id: account.id,
        amount,
        currency: account.currency,
        merchant_name: randomFrom(MERCHANTS),
        merchant_category: 'retail',
        country_code: account.homeCountry,
        city: account.city,
        ip_address: `${(0, patterns_1.randomInt)(50, 200)}.${(0, patterns_1.randomInt)(0, 255)}.${(0, patterns_1.randomInt)(0, 255)}.${(0, patterns_1.randomInt)(1, 254)}`,
        latitude: jitter(account.latitude, 0.05),
        longitude: jitter(account.longitude, 0.05),
        channel: randomFrom(CHANNELS),
    };
}
// Generate a normal transaction — matches account's typical behavior
function generateNormal(account) {
    return {
        drafts: [buildBaseTransaction(account)],
        type: 'NORMAL',
        patterns: [],
    };
}
// Generate a suspicious transaction — applies 1-3 random fraud patterns
function generateSuspicious(account, fraudRatio) {
    const base = buildBaseTransaction(account);
    // Pick 1-3 patterns to apply
    // More patterns = higher composite risk score = more likely to alert
    const patternCount = (0, patterns_1.randomInt)(1, 3);
    const shuffled = [...FRAUD_PATTERNS].sort(() => Math.random() - 0.5);
    const selectedPatterns = shuffled.slice(0, patternCount);
    // Check if rapid_fire is selected — it changes the return shape
    const hasRapidFire = selectedPatterns.includes('rapid_fire');
    let tx = { ...base };
    const appliedPatterns = [];
    // Apply each selected pattern in sequence
    // Each pattern transforms the transaction object
    for (const pattern of selectedPatterns) {
        switch (pattern) {
            case 'high_amount':
                tx = (0, patterns_1.applyHighAmount)(tx, account.maxSpend);
                appliedPatterns.push('high_amount');
                break;
            case 'foreign_country':
                tx = (0, patterns_1.applyForeignCountry)(tx);
                appliedPatterns.push('foreign_country');
                break;
            case 'odd_hour':
                tx = (0, patterns_1.applyOddHour)(tx);
                appliedPatterns.push('odd_hour');
                break;
            case 'round_amount':
                tx = (0, patterns_1.applyRoundAmount)(tx);
                appliedPatterns.push('round_amount');
                break;
            case 'rapid_fire':
                // Don't apply now — handled below
                appliedPatterns.push('rapid_fire');
                break;
        }
    }
    if (hasRapidFire) {
        // rapid_fire generates a burst of 5-8 transactions
        const burstCount = (0, patterns_1.randomInt)(5, 8);
        const bursts = (0, patterns_1.applyRapidFire)(tx, burstCount);
        return {
            drafts: bursts,
            type: 'SUSPICIOUS',
            patterns: appliedPatterns,
        };
    }
    return {
        drafts: [tx],
        type: 'SUSPICIOUS',
        patterns: appliedPatterns,
    };
}
//# sourceMappingURL=generator.js.map