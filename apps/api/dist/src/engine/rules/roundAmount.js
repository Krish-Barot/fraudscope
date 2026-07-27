"use strict";
// apps/api/src/engine/rules/roundAmount.ts
// Round amount — flags suspiciously round transaction amounts
//
// WHY THIS CATCHES FRAUD:
// Real purchases have messy prices: $47.83, $129.99, $23.50
// Fraudsters doing manual transfers or running scripts default to
// round numbers: $1,000, $5,000, $10,000.
//
// STRUCTURING / THRESHOLD AVOIDANCE:
// Many jurisdictions require banks to report transactions above certain
// thresholds (e.g. $10,000 in Canada/US). Criminals deliberately stay
// just below these thresholds. A round $9,000 or $9,500 is suspicious.
// The tolerance parameter catches near-round amounts for this reason.
//
// AMOUNT-TIERED SCORING:
// Unlike other rules that use severityToScore(), this rule uses fixed
// tiers based on the transaction amount itself:
//   $1,000-$4,999  → score 15  (suspicious but common)
//   $5,000-$9,999  → score 20  (more suspicious, approaching thresholds)
//   $10,000+       → score 25  (common reporting threshold target)
//
// The tier boundaries are not arbitrary — $10,000 is the FINTRAC
// (Canada) and FinCEN (US) large cash transaction reporting threshold.
//
// TOLERANCE PARAMETER:
// tolerance=0: only exact multiples of 100 ($1000, $2000, $5000)
// tolerance=1: also catches near-round ($999, $1001, $4999, $5001)
// The tolerance applies to BOTH sides of the round number:
//   amount % 100 <= tolerance          (just above: $5,001)
//   amount % 100 >= (100 - tolerance)  (just below: $4,999)
//
// NEAREST ROUND CALCULATION:
// We include the nearest round number in the details so the alert
// shows analysts: "$4,999 — suspiciously close to $5,000"
Object.defineProperty(exports, "__esModule", { value: true });
exports.parameterSchema = void 0;
exports.nearestRound = nearestRound;
exports.isRoundAmount = isRoundAmount;
exports.getAmountScore = getAmountScore;
exports.evaluate = evaluate;
const zod_1 = require("zod");
exports.parameterSchema = zod_1.z.object({
    min_amount: zod_1.z
        .number()
        .min(0, 'min_amount cannot be negative'),
    tolerance: zod_1.z
        .number()
        .min(0, 'tolerance cannot be negative')
        .max(5, 'tolerance must be at most 5')
        .default(0),
});
// ─────────────────────────────────────────
// Calculate the nearest round number (multiple of 100)
// Used in the details object for analyst context
// ─────────────────────────────────────────
function nearestRound(amount) {
    return Math.round(amount / 100) * 100;
}
// ─────────────────────────────────────────
// Determine if an amount is "round" within tolerance
// Returns true if:
//   - amount is exactly divisible by 100 (within tolerance above)
//   - amount is within tolerance below the next multiple of 100
// ─────────────────────────────────────────
function isRoundAmount(amount, tolerance) {
    // Use toFixed(2) to avoid floating point issues
    // e.g. 5000.1 % 100 might return 0.09999... instead of 0.1
    const remainder = parseFloat((amount % 100).toFixed(2));
    // Just above a round number: $5,001 with tolerance=1 → remainder=1 → 1<=1 ✓
    const justAbove = remainder <= tolerance;
    // Just below a round number: $4,999 with tolerance=1 → remainder=99 → 99>=(100-1) ✓
    const justBelow = remainder >= (100 - tolerance);
    return justAbove || justBelow;
}
// ─────────────────────────────────────────
// Determine score tier based on amount
// Higher amounts → higher scores
// ─────────────────────────────────────────
function getAmountScore(amount) {
    if (amount >= 10000)
        return 25; // $10,000+ — reporting threshold territory
    if (amount >= 5000)
        return 20; // $5,000-$9,999 — approaching threshold
    return 15; // $1,000-$4,999 — suspicious but lower risk
}
async function evaluate(transaction, parameters, _context // unused — purely computational rule
) {
    const params = exports.parameterSchema.parse(parameters);
    const { min_amount, tolerance } = params;
    // ── Early exit: skip transactions below min_amount ────────────
    if (transaction.amount < min_amount) {
        return {
            triggered: false,
            score: 0,
            details: {
                rule_type: 'round_amount',
                skipped: 'below_min_amount',
                amount: transaction.amount,
                min_amount,
            },
        };
    }
    // ── Check if amount is round within tolerance ─────────────────
    const isRound = isRoundAmount(transaction.amount, tolerance);
    // ── Also check for exact multiples of $500 and $1,000 ─────────
    // Even if not caught by the 100-tolerance check, exact multiples
    // of 500 and 1000 are especially suspicious (common structured amounts)
    const isExactFiveHundred = parseFloat((transaction.amount % 500).toFixed(2)) === 0
        && transaction.amount >= 500;
    const isExactThousand = parseFloat((transaction.amount % 1000).toFixed(2)) === 0
        && transaction.amount >= 1000;
    // Rule triggers if EITHER condition is true
    const triggered = isRound || isExactFiveHundred;
    // ── Calculate score tier ──────────────────────────────────────
    const score = triggered ? getAmountScore(transaction.amount) : 0;
    // ── Calculate nearest round for details ──────────────────────
    const nearest = nearestRound(transaction.amount);
    return {
        triggered,
        score,
        details: {
            rule_type: 'round_amount',
            amount: transaction.amount,
            min_amount,
            tolerance,
            is_exact_round: parseFloat((transaction.amount % 100).toFixed(2)) === 0,
            is_exact_thousand: isExactThousand,
            is_exact_five_hundred: isExactFiveHundred,
            nearest_round: nearest,
            score_tier: triggered
                ? (transaction.amount >= 10000 ? '$10,000+' : transaction.amount >= 5000 ? '$5,000-$9,999' : '$1,000-$4,999')
                : null,
            message: triggered
                ? `Suspicious round amount: $${transaction.amount.toFixed(2)} (nearest round: $${nearest.toFixed(2)})`
                : null,
        },
    };
}
//# sourceMappingURL=roundAmount.js.map