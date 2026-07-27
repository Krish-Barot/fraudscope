"use strict";
// apps/api/src/engine/rules/constants.ts
// Shared constants used across multiple rule modules
//
// WHY A SEPARATE FILE:
// High-risk countries are referenced in geo_mismatch rule logic
// and potentially in analytics/reporting. Centralising them means
// one place to update when the list changes — no hunting through rule files.
//
// SOURCE OF TRUTH:
// This list is derived from fraud databases and financial crime reports.
// In a production system this would be configurable via the admin panel
// or fetched from a third-party risk intelligence API.
// For FraudScope, we hardcode a representative set.
Object.defineProperty(exports, "__esModule", { value: true });
exports.GEO_CACHE_TTL_SECONDS = exports.GEO_SCORE_UNKNOWN = exports.GEO_SCORE_HIGH_RISK = exports.HIGH_RISK_COUNTRIES = void 0;
// Countries with elevated fraud risk for card-not-present transactions
// Transactions originating from these countries score higher than
// unknown-but-not-high-risk countries
exports.HIGH_RISK_COUNTRIES = new Set([
    'NG', // Nigeria
    'RU', // Russia
    'KP', // North Korea
    'IR', // Iran
    'VE', // Venezuela
    'BY', // Belarus
    'PH', // Philippines (added based on card fraud data)
    'RO', // Romania (added based on card fraud data)
    'UA', // Ukraine
]);
// Score constants — used by geo_mismatch and potentially other rules
exports.GEO_SCORE_HIGH_RISK = 25; // new country AND high-risk
exports.GEO_SCORE_UNKNOWN = 20; // new country but not high-risk
// Redis TTL for geo history lists
// 30 days — if account is inactive for 30 days, reset known countries
exports.GEO_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
//# sourceMappingURL=constants.js.map