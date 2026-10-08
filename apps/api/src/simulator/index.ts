// apps/api/src/simulator/index.ts
// Main simulator loop
// Reads env config, generates transactions, POSTs them to the API
// Runs continuously until killed
//
// Start with: SIM_ENABLED=true tsx src/simulator/index.ts
// Or via docker: docker compose exec api sh -c "cd apps/api && SIM_ENABLED=true npm run worker"
// (we'll add a proper sim script to package.json below)

import { generateAccounts, AccountProfile } from './accounts';
import { generateNormal, generateSuspicious, GeneratedTransaction } from './generator';

// ─────────────────────────────────────────
// Configuration from environment variables
// ─────────────────────────────────────────
const SIM_ENABLED = process.env.SIM_ENABLED === 'true';
const SIM_RATE = parseInt(process.env.SIM_RATE || '5', 10);       // tx per second
const SIM_FRAUD_RATIO = parseFloat(process.env.SIM_FRAUD_RATIO || '0.10'); // 10% suspicious
const API_URL = process.env.API_URL || 'http://localhost:3002';
const API_KEY = process.env.API_KEY || 'dev_api_key_fraudscope';

// Guard — exit immediately if simulator is not enabled
// This prevents the simulator from accidentally running in production
if (!SIM_ENABLED) {
  console.log('Simulator is disabled. Set SIM_ENABLED=true to run.');
  process.exit(0);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('FraudScope Transaction Simulator');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Rate:        ${SIM_RATE} tx/second`);
console.log(`Fraud ratio: ${(SIM_FRAUD_RATIO * 100).toFixed(0)}% suspicious`);
console.log(`API:         ${API_URL}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Generate accounts once — they persist for the lifetime of the process
const accounts = generateAccounts();
console.log(`Generated ${accounts.length} mock account profiles`);

// Statistics tracking — printed every 10 seconds
const stats = {
  sent: 0,
  succeeded: 0,
  failed: 0,
  suspicious: 0,
  startTime: Date.now(),
};

// ─────────────────────────────────────────
// POST a transaction to the API
// ─────────────────────────────────────────
async function postTransaction(draft: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify(draft),
    });

    if (response.status === 202) {
      return true;
    }

    if (response.status === 409) {
      // Duplicate external_id — not a real error, just means we sent this before
      // This can happen if the simulator restarts quickly
      return true;
    }

    const error = await response.json();
    console.error(`API error ${response.status}:`, JSON.stringify(error));
    return false;
  } catch (err) {
    // Network error — API might be starting up
    console.error('Network error posting transaction:', (err as Error).message);
    return false;
  }
}

// ─────────────────────────────────────────
// Process one generated transaction result
// (may include multiple drafts for rapid_fire)
// ─────────────────────────────────────────
async function sendGenerated(generated: GeneratedTransaction): Promise<void> {
  const { drafts, type, patterns } = generated;

  for (const draft of drafts) {
    stats.sent++;

    // Build the payload — remove undefined fields (API rejects them)
    const payload: Record<string, unknown> = {
      external_id: draft.external_id,
      account_id: draft.account_id,
      amount: draft.amount,
      currency: draft.currency,
      merchant_name: draft.merchant_name,
      merchant_category: draft.merchant_category,
      country_code: draft.country_code,
      channel: draft.channel,
    };

    // Only include optional fields if they have values
    if (draft.city) payload.city = draft.city;
    if (draft.ip_address) payload.ip_address = draft.ip_address;
    if (draft.latitude !== undefined) payload.latitude = draft.latitude;
    if (draft.longitude !== undefined) payload.longitude = draft.longitude;

    const success = await postTransaction(payload);

    if (success) {
      stats.succeeded++;

      // Log with clear visual distinction between normal and suspicious
      if (type === 'SUSPICIOUS') {
        stats.suspicious++;
        console.log(
          `[SUSPICIOUS] ${draft.account_id} | $${draft.amount} ${draft.currency} | ` +
          `${draft.country_code} | patterns: ${patterns.join(', ')}`
        );
      } else {
        console.log(
          `[NORMAL]     ${draft.account_id} | $${draft.amount} ${draft.currency} | ` +
          `${draft.country_code} | ${draft.channel}`
        );
      }
    } else {
      stats.failed++;
      console.error(`[FAILED]     ${draft.external_id}`);
    }
  }
}

// ─────────────────────────────────────────
// Pick a random account from the pool
// ─────────────────────────────────────────
function pickAccount(): AccountProfile {
  return accounts[Math.floor(Math.random() * accounts.length)];
}

// ─────────────────────────────────────────
// Main loop
// Runs at SIM_RATE transactions per second
// ─────────────────────────────────────────
async function tick(): Promise<void> {
  const account = pickAccount();

  // Decide: normal or suspicious?
  const isSuspicious = Math.random() < SIM_FRAUD_RATIO;

  const generated = isSuspicious
    ? generateSuspicious(account, SIM_FRAUD_RATIO)
    : generateNormal(account);

  await sendGenerated(generated);
}

// ─────────────────────────────────────────
// Stats printer — runs every 10 seconds
// Shows overall simulator health at a glance
// ─────────────────────────────────────────
function printStats(): void {
  const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0);
  const actualRate = (stats.succeeded / parseFloat(elapsed)).toFixed(1);

  console.log('─────────────────────────────────────────');
  console.log(`Stats after ${elapsed}s:`);
  console.log(`  Sent:       ${stats.sent}`);
  console.log(`  Succeeded:  ${stats.succeeded}`);
  console.log(`  Failed:     ${stats.failed}`);
  console.log(`  Suspicious: ${stats.suspicious} (${((stats.suspicious / stats.sent) * 100).toFixed(1)}%)`);
  console.log(`  Rate:       ${actualRate} tx/s actual vs ${SIM_RATE} tx/s target`);
  console.log('─────────────────────────────────────────');
}

// ─────────────────────────────────────────
// Start the simulator
// setInterval fires the tick function at the configured rate
// 1000ms / SIM_RATE = interval between transactions
// e.g. SIM_RATE=5 → tick every 200ms
// ─────────────────────────────────────────
const intervalMs = Math.floor(1000 / SIM_RATE);
console.log(`Starting loop — tick every ${intervalMs}ms`);

const simInterval = setInterval(async () => {
  await tick();
}, intervalMs);

// Print stats every 10 seconds
const statsInterval = setInterval(printStats, 10000);

// Graceful shutdown — stop the loop cleanly on Ctrl+C or Docker stop
process.on('SIGTERM', () => {
  console.log('\nShutting down simulator...');
  clearInterval(simInterval);
  clearInterval(statsInterval);
  printStats();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nShutting down simulator...');
  clearInterval(simInterval);
  clearInterval(statsInterval);
  printStats();
  process.exit(0);
});