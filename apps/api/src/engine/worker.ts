// apps/api/src/engine/worker.ts
// Redis Stream consumer — reads transactions and passes to scorer
//
// RESPONSIBILITIES (deliberately narrow):
//   - Manage Redis Stream consumption (XREADGROUP, XACK, XAUTOCLAIM)
//   - Call scorer.evaluateAndProcess() for each message
//   - Handle graceful shutdown (finish current batch before exiting)
//   - Log results
//
// NOT RESPONSIBLE FOR:
//   - Fraud rule evaluation (scorer.ts)
//   - Alert creation (scorer.ts)
//   - Database writes (scorer.ts)
//   - Redis PubSub publishing (scorer.ts)

import { validateWorkerEnv } from "../config/env";
const env = validateWorkerEnv();

import Redis from "ioredis";
import { db } from "../config/database";
import { unlink, writeFile } from "fs/promises";
import { evaluateAndProcess } from "./scorer";
import { TransactionData } from "./rules/types";

// ─────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────
const STREAM_NAME = "tx:incoming";
const GROUP_NAME = "engine-workers";
const CONSUMER_NAME = `worker-${process.env.HOSTNAME || "local"}`;
const BATCH_SIZE = 10;
const BLOCK_TIMEOUT = 2000; // block up to 2s per read cycle to allow shutdown checks
const HEALTH_FILE = "/tmp/worker-health";
const HEALTH_HEARTBEAT_MS = 5000;

// ─────────────────────────────────────────
// Redis clients
// Two clients: reader (stream ops) and publisher (pub/sub)
// They cannot share a connection — see scorer.ts for explanation
// ─────────────────────────────────────────
const reader = new Redis(env.REDIS_URL || "redis://redis:6379", {
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

reader.on("connect", () => console.log("✅ Worker Redis reader connected"));
reader.on("error", (err) =>
  console.error("✗ Worker Redis error:", err.message),
);

// ─────────────────────────────────────────
// Shutdown flag — set by signal handlers
// The main loop checks this after each batch
// ─────────────────────────────────────────
let shuttingDown = false;
let healthInterval: NodeJS.Timeout | null = null;

function getRedisErrorDetails(error: unknown): { code?: string; message: string } {
  if (typeof error === "object" && error !== null) {
    const errObj = error as { code?: unknown; message?: unknown };
    return {
      code: typeof errObj.code === "string" ? errObj.code : undefined,
      message: typeof errObj.message === "string" ? errObj.message : String(error),
    };
  }
  return { message: String(error) };
}

async function markWorkerHealthy(): Promise<void> {
  try {
    await writeFile(HEALTH_FILE, `${new Date().toISOString()}\n`, "utf8");
  } catch (error) {
    console.error("Failed to write health check file:", error);
  }
}

function startHealthHeartbeat(): void {
  if (healthInterval) return;
  markWorkerHealthy();
  healthInterval = setInterval(() => {
    markWorkerHealthy();
  }, HEALTH_HEARTBEAT_MS);
}

function stopHealthHeartbeat(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}

async function clearWorkerHealth(): Promise<void> {
  stopHealthHeartbeat();
  try {
    await unlink(HEALTH_FILE);
  } catch (error: unknown) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code !== "ENOENT") {
      throw error;
    }
  }
}

async function waitForRedisReady(maxRetries = 10, delayMs = 1000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const pong = await reader.ping();
      if (pong === "PONG") {
        return;
      }
    } catch (err) {
      console.warn(
        `[Redis Wait] Attempt ${attempt}/${maxRetries} failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Redis did not become ready in time");
}

// ─────────────────────────────────────────
// Parse Redis Stream message fields
// Fields arrive as flat alternating [key, value, key, value, ...]
// ─────────────────────────────────────────
function parseStreamMessage(fields: string[]): TransactionData {
  const raw: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    raw[fields[i]] = fields[i + 1];
  }

  return {
    id: raw.id,
    external_id: raw.external_id,
    account_id: raw.account_id,
    amount: parseFloat(raw.amount),
    currency: raw.currency,
    country_code: raw.country_code,
    channel: raw.channel || "",
    created_at: raw.created_at,
  };
}

// ─────────────────────────────────────────
// Ensure consumer group exists
// Idempotent — safe to call on every startup
// ─────────────────────────────────────────
async function ensureConsumerGroup(): Promise<void> {
  try {
    await reader.xgroup("CREATE", STREAM_NAME, GROUP_NAME, "$", "MKSTREAM");
    console.log(` Consumer group '${GROUP_NAME}' created`);
  } catch (error: unknown) {
    const { code, message } = getRedisErrorDetails(error);
    if (code === "BUSYGROUP" || message.includes("BUSYGROUP")) {
      console.log(`✅ Consumer group '${GROUP_NAME}' already exists`);
    } else {
      throw error;
    }
  }
}

// ─────────────────────────────────────────
// Reclaim messages pending from crashed workers
// Messages that were delivered but not ACKed in a previous run
// get reassigned to this worker on startup
// ─────────────────────────────────────────
async function reclaimPendingMessages(): Promise<void> {
  try {
    // Check the group's pending count before attempting XAUTOCLAIM.
    // On a fresh group there is nothing to reclaim, so exit quietly.
    const pendingSummary = (await reader.xpending(
      STREAM_NAME,
      GROUP_NAME,
    )) as unknown;

    const pendingCount = Array.isArray(pendingSummary)
      ? typeof pendingSummary[0] === "number"
        ? pendingSummary[0]
        : pendingSummary.length
      : Number(pendingSummary ?? 0);

    if (!pendingCount) {
      console.log("✅ No pending messages to reclaim");
      return;
    }

    const result = (await reader.xautoclaim(
      STREAM_NAME,
      GROUP_NAME,
      CONSUMER_NAME,
      5 * 60 * 1000,
      "0-0",
      "COUNT",
      BATCH_SIZE,
    )) as
      | [string, Array<[string, string[]]>]
      | [string, Array<[string, string[]]>, string[]];

    const messages = result[1];
    if (messages && messages.length > 0) {
      console.log(`↺ Reclaiming ${messages.length} pending messages`);
      for (const [messageId, fields] of messages) {
        await processMessage(messageId, fields);
      }
    } else {
      console.log("✅ No pending messages to reclaim");
    }
  } catch (error: unknown) {
    const { code, message } = getRedisErrorDetails(error);

    if (code === "NOGROUP" || message.includes("NOGROUP")) {
      console.warn("Consumer group missing during reclaim — recreating...");
      try {
        await ensureConsumerGroup();
      } catch (recreateErr) {
        console.error(
          "Failed to recreate consumer group during reclaim:",
          recreateErr instanceof Error ? recreateErr.message : String(recreateErr),
        );
      }
      return;
    }

    // Non-fatal — just log and continue
    console.warn("Could not check pending messages:", message);
  }
}

// ─────────────────────────────────────────
// Process a single message from the stream
// ─────────────────────────────────────────
async function processMessage(
  messageId: string,
  fields: string[],
): Promise<void> {
  const transaction = parseStreamMessage(fields);

  try {
    // Scorer handles evaluation AND database writes AND PubSub
    // Worker just calls this and logs the result
    const result = await evaluateAndProcess(transaction);

    if (result.alertId) {
      console.log(
        `[FLAGGED] ${transaction.account_id} | ` +
        `$${transaction.amount} ${transaction.currency} | ` +
        `score: ${result.score} | ` +
        `severity: ${result.severity} | ` +
        `rules: ${result.triggeredRules.map((r) => r.ruleType).join(", ")} | ` +
        `alert: ${result.alertId}`,
      );
    } else {
      console.log(
        `[CLEAN]   ${transaction.account_id} | ` +
        `$${transaction.amount} ${transaction.currency} | ` +
        `score: ${result.score}`,
      );
    }

    // XACK after successful processing
    // This removes the message from the pending entries list
    // Only ACK after success — failed messages stay pending
    // and get reclaimed on next startup
    await reader.xack(STREAM_NAME, GROUP_NAME, messageId);
  } catch (error: unknown) {
    const redisError = error as { code?: unknown; message?: unknown };
    const errorMessage =
      typeof redisError.message === "string"
        ? redisError.message
        : error instanceof Error
          ? error.message
          : String(error);

    // Foreign key violation — transaction was deleted from DB
    // This happens with stale stream messages after a DB wipe
    // Safe to ACK and discard — nothing to flag anymore
    if (redisError.code === "23503") {
      console.warn(`[SKIP] stale message discarded: ${messageId}`);
      try {
        await reader.xack(STREAM_NAME, GROUP_NAME, messageId);
      } catch (ackError) {
        console.error(
          `Failed to ACK stale message ${messageId}:`,
          ackError instanceof Error ? ackError.message : String(ackError),
        );
      }
      return;
    }

    // Any other error — do NOT ACK, leave for redelivery
    console.error(
      `[ERROR]   Failed to process ${messageId}:`,
      errorMessage,
    );
  }
}

// ─────────────────────────────────────────
// Main processing loop
// ─────────────────────────────────────────
async function runLoop(): Promise<void> {
  console.log(`✅ Worker loop started — listening on '${STREAM_NAME}'`);
  console.log(`  Consumer:  ${CONSUMER_NAME}`);
  console.log(`  Group:     ${GROUP_NAME}`);
  console.log(`  Batch:     ${BATCH_SIZE} messages per read`);
  console.log("");

  while (!shuttingDown) {
    try {
      const result = (await reader.xreadgroup(
        "GROUP",
        GROUP_NAME,
        CONSUMER_NAME,
        "COUNT",
        BATCH_SIZE,
        "BLOCK",
        BLOCK_TIMEOUT,
        "STREAMS",
        STREAM_NAME,
        ">",
      )) as Array<[string, Array<[string, string[]]>]> | null;

      if (!result || result.length === 0) continue;

      const [, messages] = result[0];
      if (!messages || messages.length === 0) continue;

      for (const [messageId, fields] of messages) {
        if (shuttingDown) break;
        await processMessage(messageId, fields);
      }
    } catch (error: unknown) {
      if (shuttingDown) break;

      const { code, message } = getRedisErrorDetails(error);
      const isNoGroupError = code === "NOGROUP" || message.includes("NOGROUP");

      if (isNoGroupError) {
        // Stream or consumer group was deleted — recreate it and retry.
        console.warn("Consumer group missing — recreating...");
        try {
          await ensureConsumerGroup();
        } catch (recreateErr) {
          console.error(
            "Failed to recreate consumer group in loop recovery:",
            recreateErr instanceof Error ? recreateErr.message : String(recreateErr),
          );
        }
      } else {
        if (message.includes("Connection is closed")) {
          console.warn("Redis connection lost — retrying in 1s");
        } else {
          console.warn("Worker loop error:", message);
        }
      }

      // Back off to avoid a tight retry loop.
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// ─────────────────────────────────────────
// Graceful shutdown
// ─────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  console.log("");
  console.log(`${signal} received — shutting down gracefully`);
  shuttingDown = true;
  stopHealthHeartbeat();

  const timeout = setTimeout(() => {
    console.error("Force quit after 30s");
    process.exit(1);
  }, 30000);

  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    await reader.quit();
    await db.destroy();
    await clearWorkerHealth();
    console.log("✅ Connections closed");
  } catch (err) {
    console.error("Error during shutdown:", err);
  }

  clearTimeout(timeout);
  console.log("✅ Worker shut down cleanly");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ─────────────────────────────────────────
// Startup
// ─────────────────────────────────────────
async function start(): Promise<void> {
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  FraudScope Rule Engine Worker");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    await db.raw("SELECT 1");
    console.log("✅ Database connected");

    await waitForRedisReady();

    await ensureConsumerGroup();
    await reclaimPendingMessages();
    startHealthHeartbeat();
    await runLoop();
  } catch (error) {
    console.error("Worker startup failed:", error);
    process.exit(1);
  }
}

start();
