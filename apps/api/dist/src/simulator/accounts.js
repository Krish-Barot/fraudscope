"use strict";
// apps/api/src/simulator/accounts.ts
// 100 mock account profiles with realistic characteristics
// Each account has a "personality" — where they live, what they spend
//
// Why profiles matter:
// The amount_anomaly rule needs a baseline per account.
// If every account spends randomly $5-$10,000, the baseline is meaningless.
// With profiles, ACC-0001 consistently spends $20-$80 (low tier),
// so a $4,000 charge stands out clearly as anomalous.
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAccounts = generateAccounts;
// City data with coordinates
// Used both for normal transactions (home city) and
// geo_mismatch detection (transaction appears in a foreign country)
const CITY_DATA = [
    { country: 'CA', city: 'Toronto', lat: 43.6532, lng: -79.3832, currency: 'CAD' },
    { country: 'CA', city: 'Vancouver', lat: 49.2827, lng: -123.1207, currency: 'CAD' },
    { country: 'CA', city: 'Montreal', lat: 45.5017, lng: -73.5673, currency: 'CAD' },
    { country: 'CA', city: 'Calgary', lat: 51.0447, lng: -114.0719, currency: 'CAD' },
    { country: 'CA', city: 'Ottawa', lat: 45.4215, lng: -75.6919, currency: 'CAD' },
    { country: 'US', city: 'New York', lat: 40.7128, lng: -74.0060, currency: 'USD' },
    { country: 'US', city: 'Chicago', lat: 41.8781, lng: -87.6298, currency: 'USD' },
    { country: 'GB', city: 'London', lat: 51.5074, lng: -0.1278, currency: 'GBP' },
    { country: 'AU', city: 'Sydney', lat: -33.8688, lng: 151.2093, currency: 'AUD' },
];
// Spend tier definitions
// 40% low, 35% medium, 20% high, 5% premium
// These match the seed data distribution so historical averages are consistent
const TIERS = [
    { tier: 'low', min: 5, max: 80, weight: 0.40 },
    { tier: 'medium', min: 20, max: 300, weight: 0.35 },
    { tier: 'high', min: 100, max: 2000, weight: 0.20 },
    { tier: 'premium', min: 500, max: 10000, weight: 0.05 },
];
function pickTier() {
    const rand = Math.random();
    let cumulative = 0;
    for (const tier of TIERS) {
        cumulative += tier.weight;
        if (rand < cumulative)
            return tier;
    }
    return TIERS[TIERS.length - 1];
}
function pickCity() {
    // Weight towards Canadian cities (60% of accounts are Canadian)
    const canadianCities = CITY_DATA.filter(c => c.country === 'CA');
    const otherCities = CITY_DATA.filter(c => c.country !== 'CA');
    if (Math.random() < 0.60) {
        return canadianCities[Math.floor(Math.random() * canadianCities.length)];
    }
    return otherCities[Math.floor(Math.random() * otherCities.length)];
}
// Generate all 100 accounts once at startup
// They stay in memory for the lifetime of the simulator process
function generateAccounts() {
    const accounts = [];
    for (let i = 1; i <= 100; i++) {
        const cityData = pickCity();
        const tierData = pickTier();
        accounts.push({
            id: `ACC-${String(i).padStart(4, '0')}`,
            homeCountry: cityData.country,
            city: cityData.city,
            latitude: cityData.lat,
            longitude: cityData.lng,
            currency: cityData.currency,
            minSpend: tierData.min,
            maxSpend: tierData.max,
            tier: tierData.tier,
        });
    }
    return accounts;
}
//# sourceMappingURL=accounts.js.map