// apps/api/src/engine/rules/timeAnomaly.ts
// Time anomaly — flags transactions during unusual hours
//
// Most legitimate purchases happen during waking hours.
// Fraudsters often run automated scripts at night when the
// cardholder is asleep and less likely to notice the charge.
//
// Note: We check the hour in the configured timezone.
// A 3 AM transaction in Toronto is suspicious.
// The same UTC timestamp might be 8 AM somewhere else — not suspicious.

import { z } from "zod";
import {
  RuleResult,
  TransactionData,
  RuleContext,
  severityToScore,
} from "./types";

export const parameterSchema = z.object({
  suspicious_start_hour: z.number().int().min(0).max(23),
  suspicious_end_hour: z.number().int().min(0).max(23),
  timezone: z.string().default("America/Toronto"),
});

export async function evaluate(
  transaction: TransactionData,
  parameters: Record<string, unknown>,
  context: RuleContext,
): Promise<RuleResult> {
  const params = parameterSchema.parse(parameters);
  const { suspicious_start_hour, suspicious_end_hour, timezone } = params;

  const txDate = new Date(transaction.created_at);

  // Intl.DateTimeFormat gives us the local time in any timezone
  // without needing a heavy library like moment.js
  const localHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).format(txDate),
    10,
  );

  // Handle window that crosses midnight (e.g. 22:00 to 04:00)
  let triggered: boolean;
  if (suspicious_start_hour <= suspicious_end_hour) {
    // Normal window: e.g. 02:00 to 05:00
    triggered =
      localHour >= suspicious_start_hour && localHour < suspicious_end_hour;
  } else {
    // Midnight-crossing window: e.g. 22:00 to 04:00
    triggered =
      localHour >= suspicious_start_hour || localHour < suspicious_end_hour;
  }

  return {
    triggered,
    score: triggered ? severityToScore(context.severity) : 0,
    details: {
      rule_type: "time_anomaly",
      transaction_hour: localHour,
      suspicious_window: `${suspicious_start_hour}:00 - ${suspicious_end_hour}:00`,
      timezone,
      transaction_local_time: new Intl.DateTimeFormat("en-CA", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: timezone,
        hour12: false,
      }).format(txDate),
      message: triggered
        ? `Transaction at ${localHour}:00 local time (${timezone}) — suspicious window: ${suspicious_start_hour}:00-${suspicious_end_hour}:00`
        : null,
    },
  };
}
