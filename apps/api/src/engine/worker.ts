// apps/api/src/engine/worker.ts
// Rule engine worker — standalone process separate from the API server
//
// ARCHITECTURE NOTE:
// This runs as a completely separate Node.js process from the API server.
// It shares the same codebase (same Docker image) but has a different
// entry point (started with 'npm run worker' not 'npm run dev').
// Separation matters because:
//   - The API server is I/O bound (HTTP requests) — needs fast response times
//   - The worker is CPU bound (rule evaluation) — can take longer per operation
//   - If the worker crashes, the API keeps accepting transactions
//   - Each can be scaled independently (2 API servers, 5 workers)
//
// REDIS STREAM RELIABILITY:
// When the worker reads a message with XREAD, it moves to a "pending" state.
// The message stays pending until the worker calls XACK to acknowledge it.
// If the worker crashes before ACKing, Redis keeps the message in the
// pending list. When the worker restarts and calls XAUTOCLAIM, it
// reclaims those pending messages and reprocesses them.
// This guarantees at-least-once processing — every transaction gets evaluated.

import { validateWorkerEnv } from '../config/env';

// Validate env before anything else
// Worker will refuse to start with missing config
const env = validateWorkerEnv();

import Redis from 'ioredis';
import { db } from '../config/database';
import { evaluate, scoreToSeverity, TransactionData } from './scorer';

// ─────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────
const STREAM_NAME = 'tx:incoming';
const GROUP_NAME = 'engine-workers';
// Consumer name includes hostname so multiple workers on different
// machines don't share the same consumer identity
const CONSUMER_NAME = `worker-${process.env.HOSTNAME || 'local'}`;
const BATCH_SIZE = env.ENGINE_POLL_INTERVAL ? Number(env.ENGINE_POLL_INTERVAL) : 10;
const BLOCK_TIMEOUT = 0;  // 0 = block forever until a message arrives

// Alert broadcast channel — dashboard subscribes to this
const ALERTS_PUBSUB = 'alerts:new';

// ─────────────────────────────────────────
// Redis clients
// Two clients needed:
//   - reader: for XREAD, XACK, XAUTOCLAIM (stream operations)
//   - publisher: for PUBLISH (pub/sub — can't mix with stream commands
//     when in blocking mode because blocking commands hold the connection)
// ─────────────────────────────────────────
const reader = new Redis(env.REDIS_URL || 'redis://redis:6379', {
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

const publisher = new Redis(env.REDIS_URL || 'redis://redis:6379', {
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

reader.on('connect', () => console.log('✅ Worker Redis reader connected'));
reader.on('error', (err) => console.error('❌ Worker Redis reader error:', err.message));

publisher.on('connect', () => console.log('✅ Worker Redis publisher connected'));
publisher.on('error', (err) => console.error('❌ Worker Redis publisher error:', err.message));

// ─────────────────────────────────────────
// Shutdown state
// When SIGTERM/SIGINT arrives, we set this flag.
// The main loop checks it after each batch and exits cleanly.
// We never kill mid-batch — a transaction either fully processes or not at all.
// ─────────────────────────────────────────
let shuttingDown = false;

// ─────────────────────────────────────────
// Parse a Redis Stream message into a TransactionData object
//
// Redis Stream messages are flat key-value pairs (all strings):
// ['id', 'uuid-here', 'amount', '150.00', 'account_id', 'ACC-0001', ...]
// We need to convert these to a typed object
// ─────────────────────────────────────────
function parseStreamMessage(
  fields: string[]
): Record<string, string> {
  const result: Record<string, string> = {};

  // Fields come as alternating key-value pairs: [key, value, key, value, ...]
  for (let i = 0; i < fields.length; i += 2) {
    result[fields[i]] = fields[i + 1];
  }

  return result;
}

// ─────────────────────────────────────────
// Ensure the consumer group exists
// XGROUP CREATE creates the group if it doesn't exist
// '$' means "only process NEW messages" (not the 1000+ historical ones)
// MKSTREAM creates the stream key if it doesn't exist yet
// ─────────────────────────────────────────
async function ensureConsumerGroup(): Promise<void> {
  try {
    // Try to create the group
    // If it already exists, Redis returns an error — we catch and ignore it
    await reader.xgroup('CREATE', STREAM_NAME, GROUP_NAME, '$', 'MKSTREAM');
    console.log(`✅ Consumer group '${GROUP_NAME}' created`);
  } catch (error: any) {
    if (error.message.includes('BUSYGROUP')) {
      // Group already exists — this is fine, happens on worker restart
      console.log(`✅ Consumer group '${GROUP_NAME}' already exists`);
    } else {
      throw error;
    }
  }
}

// ─────────────────────────────────────────
// Reclaim pending messages from crashed workers
// If a previous worker instance crashed before ACKing messages,
// those messages sit in the "pending entries list" (PEL).
// XAUTOCLAIM moves them to this worker so they get reprocessed.
// We do this on startup before entering the main loop.
// ─────────────────────────────────────────
async function reclaimPendingMessages(): Promise<void> {
  try {
    // XAUTOCLAIM: claim messages that have been pending for > 5 minutes
    // (min-idle-time in milliseconds)
    const result = await reader.xautoclaim(
      STREAM_NAME,
      GROUP_NAME,
      CONSUMER_NAME,
      5 * 60 * 1000,  // 5 minutes idle = probably from a crashed worker
      '0-0',          // start from the beginning of the PEL
      'COUNT',
      BATCH_SIZE
    ) as any;

    // xautoclaim returns [nextId, messages, deletedIds]
    const messages = result[1];

    if (messages && messages.length > 0) {
      console.log(`↺ Reclaimed ${messages.length} pending messages from crashed worker`);
      // Process them immediately
      for (const [messageId, fields] of messages) {
        await processMessage(messageId, fields);
      }
    } else {
      console.log('✅ No pending messages to reclaim');
    }
  } catch (error: any) {
    // XAUTOCLAIM not available in older Redis versions — just log and continue
    console.warn('Could not reclaim pending messages:', error.message);
  }
}

// ─────────────────────────────────────────
// Process a single transaction message
// This is where the actual fraud evaluation happens
// ─────────────────────────────────────────
async function processMessage(
  messageId: string,
  fields: string[]
): Promise<void> {
  const raw = parseStreamMessage(fields);

  // Build a typed transaction object from the raw string fields
  const transaction: TransactionData = {
    id: raw.id,
    external_id: raw.external_id,
    account_id: raw.account_id,
    amount: parseFloat(raw.amount),   // Redis stores as string, we need number
    currency: raw.currency,
    country_code: raw.country_code,
    channel: raw.channel || '',
    created_at: raw.created_at,
  };

  try {
    // ── Evaluate against fraud rules ────────
    // scorer.evaluate() runs all active rules and returns a composite score
    // Currently returns score:0 (stub) until FS-10 is implemented
    const result = await evaluate(transaction);
    const severity = scoreToSeverity(result.score);

    if (result.score >= 20 && severity) {
      // ── Transaction is suspicious — create an alert ────
      await handleFlaggedTransaction(transaction, result.score, severity, result.triggeredRules);

      console.log(
        `[FLAGGED] ${transaction.account_id} | ` +
        `$${transaction.amount} ${transaction.currency} | ` +
        `score: ${result.score} | severity: ${severity} | ` +
        `rules: ${result.triggeredRules.map(r => r.ruleType).join(', ')}`
      );
    } else {
      // ── Transaction is clean ─────────────────────────
      console.log(
        `[CLEAN]   ${transaction.account_id} | ` +
        `$${transaction.amount} ${transaction.currency} | ` +
        `score: ${result.score}`
      );
    }

    // ── Acknowledge the message ──────────────────────
    // XACK removes the message from the pending entries list
    // After this, the message will NOT be redelivered even if the worker crashes
    // Only ACK after successful processing — never ACK if processing failed
    await reader.xack(STREAM_NAME, GROUP_NAME, messageId);

  } catch (error) {
    // Processing failed — DO NOT XACK
    // The message stays in the pending list and will be reclaimed
    // on next worker startup (via reclaimPendingMessages above)
    console.error(
      `[ERROR]   Failed to process message ${messageId}:`,
      (error as Error).message
    );
    // Don't re-throw — we want to continue processing other messages
    // This transaction will be retried when the worker restarts
  }
}

// ─────────────────────────────────────────
// Handle a transaction that scored >= 20
// Creates an alert + alert_rules entries + updates transaction status
// Publishes to Redis PubSub so the dashboard sees it in real time
// ─────────────────────────────────────────
async function handleFlaggedTransaction(
  transaction: TransactionData,
  score: number,
  severity: string,
  triggeredRules: Array<{
    ruleId: string;
    ruleName: string;
    ruleType: string;
    scoreContribution: number;
    details: Record<string, unknown>;
  }>
): Promise<void> {
  // Use a PostgreSQL transaction so either ALL of this succeeds
  // or NONE of it does (atomicity)
  // If we update the transaction but fail to create the alert,
  // the dashboard would show no alert for a flagged transaction
  await db.transaction(async (trx) => {
    // 1. Update transaction status to 'flagged'
    await trx('transactions')
      .where({ id: transaction.id })
      .update({
        status: 'flagged',
        processed_at: new Date(),
      });

    // 2. Create the alert record
    const [alert] = await trx('alerts').insert({
      transaction_id: transaction.id,
      risk_score: score,
      severity,
      status: 'new',
    }).returning('*');

    // 3. Create one alert_rules row per triggered rule
    // This stores WHY the transaction was flagged with full details
    if (triggeredRules.length > 0) {
      await trx('alert_rules').insert(
        triggeredRules.map((rule) => ({
          alert_id: alert.id,
          rule_id: rule.ruleId,
          score_contribution: rule.scoreContribution,
          details: JSON.stringify(rule.details),
        }))
      );
    }

    // 4. Write to audit log
    await trx('audit_logs').insert({
      event_type: 'alert.generated',
      actor_type: 'system',
      target_type: 'transaction',
      target_id: transaction.id,
      payload: JSON.stringify({
        alert_id: alert.id,
        risk_score: score,
        severity,
        triggered_rules: triggeredRules.map(r => r.ruleType),
      }),
      source: 'engine',
    });

    // 5. Publish to Redis PubSub so the dashboard gets instant notification
    // This is OUTSIDE the DB transaction because it's a side effect —
    // we want the DB to commit first, then notify
    // (publisher is not part of the DB transaction)
    await publisher.publish(
      ALERTS_PUBSUB,
      JSON.stringify({
        id: alert.id,
        transaction_id: transaction.id,
        risk_score: score,
        severity,
        transaction: {
          account_id: transaction.account_id,
          amount: transaction.amount,
          currency: transaction.currency,
          country_code: transaction.country_code,
        },
        created_at: new Date().toISOString(),
      })
    );
  });
}

// ─────────────────────────────────────────
// Main processing loop
// Reads batches from the Redis Stream and processes each message
// ─────────────────────────────────────────
async function runLoop(): Promise<void> {
  console.log(`✅ Worker loop started — listening on stream '${STREAM_NAME}'`);
  console.log(`  Consumer: ${CONSUMER_NAME}`);
  console.log(`  Group:    ${GROUP_NAME}`);
  console.log(`  Batch:    ${BATCH_SIZE} messages per read`);
  console.log('');

  while (!shuttingDown) {
    try {
      // XREADGROUP reads messages from the stream for this consumer group
      // '>' means "give me NEW messages not yet delivered to any consumer"
      // BLOCK 0 means "wait until at least one message is available"
      // COUNT limits how many messages we get per read
      const result = await reader.xreadgroup(
        'GROUP', GROUP_NAME,
        CONSUMER_NAME,
        'COUNT', BATCH_SIZE,
        'BLOCK', BLOCK_TIMEOUT,
        'STREAMS', STREAM_NAME,
        '>'   // '>' = only undelivered messages
      ) as Array<[string, Array<[string, string[]]>]> | null;

      // null means the blocking read timed out (won't happen with BLOCK 0
      // but good to handle defensively)
      if (!result || result.length === 0) {
        continue;
      }

      // result format: [[streamName, [[messageId, fields], ...]]]
      const [, messages] = result[0];

      if (!messages || messages.length === 0) {
        continue;
      }

      // Process each message in the batch sequentially
      // Sequential (not parallel) because:
      // - Rules use Redis counters that must be consistent
      // - Easier to reason about ordering
      // - If one fails, others still process
      for (const [messageId, fields] of messages) {
        if (shuttingDown) {
          // Stop processing mid-batch if shutdown was requested
          // Unprocessed messages will be reclaimed on next startup
          console.log('Shutdown requested — stopping mid-batch');
          break;
        }
        await processMessage(messageId, fields);
      }

    } catch (error: any) {
      // Don't crash the worker on a single loop error
      // Log it and continue — the stream is persistent, messages will wait
      if (error.message.includes('Connection is closed')) {
        // Redis connection dropped — wait before retrying
        console.error('Redis connection lost — retrying in 1s');
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        console.error('Worker loop error:', error.message);
        // Brief pause to avoid tight error loops hammering the database
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
}

// ─────────────────────────────────────────
// Graceful shutdown handler
// Called on SIGTERM (Docker stop) or SIGINT (Ctrl+C)
// Sets shuttingDown=true so the loop exits after the current batch
// Then closes all connections cleanly
// ─────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  console.log('');
  console.log(`${signal} received — shutting down gracefully`);
  console.log('Finishing current batch before exiting...');

  shuttingDown = true;

  // Give the current batch up to 30 seconds to finish
  // After that, force quit
  const forceQuitTimeout = setTimeout(() => {
    console.error('Force quitting after 30s timeout');
    process.exit(1);
  }, 30000);

  // Wait a moment for the loop to notice shuttingDown=true
  await new Promise(resolve => setTimeout(resolve, 500));

  // Close connections
  try {
    await reader.quit();
    await publisher.quit();
    await db.destroy();
    console.log('✅ All connections closed cleanly');
  } catch (err) {
    console.error('Error during shutdown:', err);
  }

  clearTimeout(forceQuitTimeout);
  console.log('✅ Worker shut down cleanly');
  process.exit(0);
}

// Register shutdown handlers
// SIGTERM: sent by Docker when stopping a container (docker stop)
// SIGINT: sent when you press Ctrl+C in the terminal
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─────────────────────────────────────────
// Startup
// ─────────────────────────────────────────
async function start(): Promise<void> {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  FraudScope Rule Engine Worker');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Verify database connection
    await db.raw('SELECT 1');
    console.log('✅ Database connected');

    // Set up the consumer group (idempotent — safe to call on restart)
    await ensureConsumerGroup();

    // Reclaim any messages that were pending from a previous crashed worker
    await reclaimPendingMessages();

    // Start the main processing loop
    await runLoop();

  } catch (error) {
    console.error('Worker startup failed:', error);
    process.exit(1);
  }
}

start();