// apps/api/src/simulator/patterns.ts
// Fraud pattern functions — each transforms a normal transaction
// into one that should trigger specific detection rules
//
// Design principle: each pattern is independent and composable.
// A transaction can have 1-3 patterns applied simultaneously,
// which tests composite risk scoring (multiple rules firing at once).

export interface TransactionDraft {
  external_id: string;
  account_id: string;
  amount: number;
  currency: string;
  merchant_name: string;
  merchant_category: string;
  country_code: string;
  city?: string;
  ip_address?: string;
  latitude?: number;
  longitude?: number;
  channel: string;
  created_at?: Date;  // optional — only set when manipulating time
}

// High-risk countries for geo_mismatch pattern
// These are countries that appear in fraud databases frequently
// The rule engine flags transactions from these countries
export const HIGH_RISK_COUNTRIES = [
  { code: 'NG', city: 'Lagos',    lat: 6.5244,   lng: 3.3792   },
  { code: 'RU', city: 'Moscow',   lat: 55.7558,  lng: 37.6173  },
  { code: 'PH', city: 'Manila',   lat: 14.5995,  lng: 120.9842 },
  { code: 'RO', city: 'Bucharest',lat: 44.4268,  lng: 26.1025  },
  { code: 'UA', city: 'Kyiv',     lat: 50.4501,  lng: 30.5234  },
];

// ─────────────────────────────────────────
// Pattern 1: HIGH AMOUNT
// Triggers: amount_anomaly rule
// A transaction 5-20x the account's typical maximum
// ─────────────────────────────────────────
export function applyHighAmount(
  tx: TransactionDraft,
  accountMaxSpend: number
): TransactionDraft {
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
export function applyForeignCountry(tx: TransactionDraft): TransactionDraft {
  const country = HIGH_RISK_COUNTRIES[
    Math.floor(Math.random() * HIGH_RISK_COUNTRIES.length)
  ];

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
export function applyOddHour(tx: TransactionDraft): TransactionDraft {
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
export function applyRoundAmount(tx: TransactionDraft): TransactionDraft {
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
export function applyRapidFire(
  tx: TransactionDraft,
  count: number
): TransactionDraft[] {
  const transactions: TransactionDraft[] = [];
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
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}