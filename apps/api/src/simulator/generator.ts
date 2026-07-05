// apps/api/src/simulator/generator.ts
// Builds transaction objects from account profiles
// Applies fraud patterns when needed
// Returns either one transaction (normal/most fraud patterns)
// or multiple (rapid_fire pattern)

import { v4 as uuidv4 } from 'uuid';
import { AccountProfile } from './accounts';
import {
  TransactionDraft,
  applyHighAmount,
  applyForeignCountry,
  applyOddHour,
  applyRoundAmount,
  applyRapidFire,
  randomInt,
} from './patterns';

const MERCHANTS = [
  'Tim Hortons', 'Shoppers Drug Mart', 'Loblaws', 'Canadian Tire',
  'Metro', 'LCBO', 'Sport Chek', 'Best Buy', 'Amazon.ca', 'Uber',
  'Netflix', 'Apple Store', 'Steam', 'Spotify', 'Instacart',
  'Costco', 'IKEA', 'H&M', 'Zara', 'Whole Foods',
];

const CHANNELS = ['online', 'pos', 'pos', 'mobile', 'atm'] as const;
// pos appears twice → ~40% chance (realistic distribution)

const FRAUD_PATTERNS = [
  'high_amount',
  'foreign_country',
  'odd_hour',
  'round_amount',
  'rapid_fire',
] as const;

type FraudPattern = typeof FRAUD_PATTERNS[number];

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min: number, max: number): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(2));
}

// Add small geographic jitter so not all transactions from the same account
// appear at exactly the same lat/lng (more realistic)
function jitter(value: number, range: number): number {
  return parseFloat((value + (Math.random() - 0.5) * range).toFixed(7));
}

// Build a base normal transaction for an account
function buildBaseTransaction(account: AccountProfile): TransactionDraft {
  const amount = randomBetween(account.minSpend, account.maxSpend);

  return {
    external_id: `SIM-${Date.now()}-${uuidv4().slice(0, 8)}`,
    account_id: account.id,
    amount,
    currency: account.currency,
    merchant_name: randomFrom(MERCHANTS),
    merchant_category: 'retail',
    country_code: account.homeCountry,
    city: account.city,
    ip_address: `${randomInt(50, 200)}.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`,
    latitude: jitter(account.latitude, 0.05),
    longitude: jitter(account.longitude, 0.05),
    channel: randomFrom(CHANNELS),
  };
}

export interface GeneratedTransaction {
  drafts: TransactionDraft[];  // one or more (rapid_fire returns multiple)
  type: 'NORMAL' | 'SUSPICIOUS';
  patterns: string[];          // which patterns were applied (empty for normal)
}

// Generate a normal transaction — matches account's typical behavior
export function generateNormal(account: AccountProfile): GeneratedTransaction {
  return {
    drafts: [buildBaseTransaction(account)],
    type: 'NORMAL',
    patterns: [],
  };
}

// Generate a suspicious transaction — applies 1-3 random fraud patterns
export function generateSuspicious(
  account: AccountProfile,
  fraudRatio: number
): GeneratedTransaction {
  const base = buildBaseTransaction(account);

  // Pick 1-3 patterns to apply
  // More patterns = higher composite risk score = more likely to alert
  const patternCount = randomInt(1, 3);
  const shuffled = [...FRAUD_PATTERNS].sort(() => Math.random() - 0.5);
  const selectedPatterns = shuffled.slice(0, patternCount) as FraudPattern[];

  // Check if rapid_fire is selected — it changes the return shape
  const hasRapidFire = selectedPatterns.includes('rapid_fire');

  let tx = { ...base };
  const appliedPatterns: string[] = [];

  // Apply each selected pattern in sequence
  // Each pattern transforms the transaction object
  for (const pattern of selectedPatterns) {
    switch (pattern) {
      case 'high_amount':
        tx = applyHighAmount(tx, account.maxSpend);
        appliedPatterns.push('high_amount');
        break;

      case 'foreign_country':
        tx = applyForeignCountry(tx);
        appliedPatterns.push('foreign_country');
        break;

      case 'odd_hour':
        tx = applyOddHour(tx);
        appliedPatterns.push('odd_hour');
        break;

      case 'round_amount':
        tx = applyRoundAmount(tx);
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
    const burstCount = randomInt(5, 8);
    const bursts = applyRapidFire(tx, burstCount);

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