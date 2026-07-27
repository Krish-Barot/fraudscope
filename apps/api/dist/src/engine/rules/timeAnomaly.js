"use strict";
// apps/api/src/engine/rules/timeAnomaly.ts
// Time anomaly — flags transactions made during unusual hours
//
// WHY THIS CATCHES FRAUD:
// Fraudsters running automated scripts often do so at night when:
//   1. The cardholder is asleep and won't notice the charge
//   2. Bank fraud teams have reduced staffing
//   3. Automated scripts run on timers regardless of local time
// Most legitimate cardholders make purchases during waking hours (6 AM - 11 PM).
//
// WHY date-fns-tz NOT Intl.DateTimeFormat:
// Intl.DateTimeFormat converts a date to a locale string and we'd have to
// parse the hour back out of that string — fragile across environments.
// date-fns-tz gives us toZonedTime() which returns a proper Date object
// adjusted for the timezone. We call getHours() on it directly — clean, reliable.
//
// MIDNIGHT WRAP HANDLING:
// A suspicious window can cross midnight: e.g. 22:00 to 04:00
// This requires different logic than a normal window (02:00 to 05:00):
//
// Normal window (start < end):
//   Triggered when: hour >= start AND hour < end
//   Example: window 02:00-05:00, hour=03 → 03 >= 02 AND 03 < 05 → TRIGGERED
//
// Midnight-crossing window (start > end):
//   Triggered when: hour >= start OR hour < end
//   Example: window 22:00-04:00, hour=23 → 23 >= 22 → TRIGGERED
//   Example: window 22:00-04:00, hour=02 → 02 < 04 → TRIGGERED
//   Example: window 22:00-04:00, hour=12 → 12 >= 22? No. 12 < 04? No → NOT triggered
//
// SCORE IS FIXED AT 15:
// This differs from other rules which use severityToScore().
// Time anomaly is intentionally a low score — it's a compounding signal,
// not a standalone fraud indicator. A 3 AM transaction from Nigeria with
// velocity violations will compound to a high score. A 3 AM transaction
// from the account's home country might be a night shift worker.
//
// NO REDIS OR DB NEEDED:
// This rule is purely computational — it only looks at the transaction's
// timestamp. No external state required. The context parameter is accepted
// for interface consistency but marked as unused (_context).
Object.defineProperty(exports, "__esModule", { value: true });
exports.parameterSchema = void 0;
exports.isHourInWindow = isHourInWindow;
exports.evaluate = evaluate;
const zod_1 = require("zod");
const date_fns_tz_1 = require("date-fns-tz");
// Fixed score — does not vary with severity
// See "SCORE IS FIXED AT 15" note above
const TIME_ANOMALY_SCORE = 15;
exports.parameterSchema = zod_1.z.object({
    suspicious_start_hour: zod_1.z
        .number()
        .int("suspicious_start_hour must be an integer")
        .min(0, "suspicious_start_hour must be 0-23")
        .max(23, "suspicious_start_hour must be 0-23"),
    suspicious_end_hour: zod_1.z
        .number()
        .int("suspicious_end_hour must be an integer")
        .min(0, "suspicious_end_hour must be 0-23")
        .max(23, "suspicious_end_hour must be 0-23"),
    // IANA timezone string e.g. 'America/Toronto', 'Europe/London', 'Asia/Tokyo'
    // date-fns-tz validates this at runtime when toZonedTime() is called
    timezone: zod_1.z
        .string()
        .min(1, "timezone cannot be empty")
        .default("America/Toronto"),
});
// ─────────────────────────────────────────
// Helper: determine if an hour falls within a suspicious window
// Extracted as a separate function so it can be unit tested independently
// ─────────────────────────────────────────
function isHourInWindow(hour, startHour, endHour) {
    if (startHour === endHour) {
        // Window of zero width — nothing matches
        // Avoids ambiguity of "is 14:00 in the window 14:00-14:00?"
        return false;
    }
    if (startHour < endHour) {
        // Normal window — does not cross midnight
        // e.g. 02:00 to 05:00: triggered for hours 2, 3, 4
        return hour >= startHour && hour < endHour;
    }
    else {
        // Midnight-crossing window
        // e.g. 22:00 to 04:00: triggered for hours 22, 23, 0, 1, 2, 3
        return hour >= startHour || hour < endHour;
    }
}
async function evaluate(transaction, parameters, _context) {
    const params = exports.parameterSchema.parse(parameters);
    const { suspicious_start_hour, suspicious_end_hour, timezone } = params;
    // ── Convert timestamp to local timezone ───────────────────────
    // transaction.created_at is a UTC ISO string: "2026-07-15T03:23:11.000Z"
    // toZonedTime() returns a Date object where getHours() gives local time
    //
    // Example:
    //   UTC:     2026-07-15T07:23:11.000Z
    //   Toronto: 2026-07-15T03:23:11 (EDT, UTC-4)
    //   getHours() → 3
    let localDate;
    try {
        const utcDate = new Date(transaction.created_at);
        // Validate timezone by attempting to format with it
        // Intl.DateTimeFormat throws a RangeError for invalid timezones
        // date-fns-tz itself does not throw — it silently falls back to UTC
        new Intl.DateTimeFormat("en-US", { timeZone: timezone });
        localDate = (0, date_fns_tz_1.toZonedTime)(utcDate, timezone);
    }
    catch (err) {
        console.warn(`time_anomaly: invalid timezone '${timezone}' — skipping rule`, err.message);
        return {
            triggered: false,
            score: 0,
            details: {
                rule_type: "time_anomaly",
                skipped: "invalid_timezone",
                timezone,
            },
        };
    }
    const localHour = localDate.getHours(); // 0-23
    // Format local time as HH:MM for the details object
    // e.g. "03:23"
    const localTimeFormatted = [
        String(localDate.getHours()).padStart(2, "0"),
        String(localDate.getMinutes()).padStart(2, "0"),
    ].join(":");
    // ── Check if the hour falls in the suspicious window ─────────
    const triggered = isHourInWindow(localHour, suspicious_start_hour, suspicious_end_hour);
    // Format the window for display: "02:00 - 05:00"
    const windowFormatted = `${String(suspicious_start_hour).padStart(2, "0")}:00` +
        ` - ` +
        `${String(suspicious_end_hour).padStart(2, "0")}:00`;
    // Determine window type for the message
    const crossesMidnight = suspicious_start_hour > suspicious_end_hour;
    return {
        triggered,
        // Fixed score of 15 — see note at top of file
        score: triggered ? TIME_ANOMALY_SCORE : 0,
        details: {
            rule_type: "time_anomaly",
            transaction_hour: localHour,
            transaction_local_time: localTimeFormatted,
            suspicious_window: windowFormatted,
            timezone,
            crosses_midnight: crossesMidnight,
            message: triggered
                ? `Transaction at ${localTimeFormatted} local time (${timezone}) falls in suspicious window ${windowFormatted}`
                : null,
        },
    };
}
//# sourceMappingURL=timeAnomaly.js.map