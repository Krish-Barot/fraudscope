// apps/api/src/modules/engine/engine.service.ts
// Event-driven engine service for asynchronous fraud rule evaluation in serverless environments

import { db } from '../../config/database';
import { redisClient, redisPublisher } from '../../config/redis';
import { evaluateAndProcess, ProcessResult } from '../../engine/scorer';
import { TransactionData } from '../../engine/rules/types';

const TX_STREAM = 'tx:incoming';
const TX_PUBSUB = 'tx:live';

import { send as vercelQueueSend } from '@vercel/queue';

/**
 * Enqueue a transaction for asynchronous fraud rule evaluation.
 * Used by transaction ingestion.
 */
export async function enqueueTransaction(transaction: {
  id: string;
  external_id: string;
  account_id: string;
  amount: number | string;
  currency: string;
  country_code: string;
  channel?: string | null;
  created_at: Date | string;
}): Promise<void> {
  const createdAtIso = transaction.created_at instanceof Date
    ? transaction.created_at.toISOString()
    : new Date(transaction.created_at).toISOString();

  // 1. Add to Redis Stream (durable stream backlog)
  try {
    await redisClient.xadd(
      TX_STREAM, '*',
      'id', transaction.id,
      'external_id', transaction.external_id,
      'account_id', transaction.account_id,
      'amount', transaction.amount.toString(),
      'currency', transaction.currency,
      'country_code', transaction.country_code,
      'channel', transaction.channel || '',
      'created_at', createdAtIso,
    );
  } catch (err) {
    console.warn('[Engine] Failed to add to Redis stream:', (err as Error).message);
  }

  // 2. Publish to live feed pub/sub
  try {
    await redisPublisher.publish(
      TX_PUBSUB,
      JSON.stringify({
        id: transaction.id,
        account_id: transaction.account_id,
        amount: transaction.amount,
        currency: transaction.currency,
        country_code: transaction.country_code,
        channel: transaction.channel,
        status: 'clean',
        created_at: createdAtIso,
      }),
    );
  } catch (err) {
    console.warn('[Engine] Failed to publish to tx:live:', (err as Error).message);
  }

  // 3. If Vercel Queues is active, enqueue to the Vercel Queue topic
  if (vercelQueueSend && process.env.VERCEL) {
    try {
      await vercelQueueSend('fraudscope-transactions', transaction, {
        idempotencyKey: transaction.id,
        retentionSeconds: 86400,
      });
    } catch (err) {
      console.warn('[Engine] Failed to send to Vercel Queue:', (err as Error).message);
    }
  }

  // 4. In development / testing or immediate evaluation mode, schedule processing asynchronously
  if (process.env.NODE_ENV !== 'production' || process.env.ASYNC_IMMEDIATE_EVAL === 'true') {
    setImmediate(() => {
      processSingleTransaction(transaction.id).catch((err) => {
        console.error(`[Engine] Immediate async evaluation failed for ${transaction.id}:`, err);
      });
    });
  }
}

/**
 * Process a single transaction by ID or payload.
 * Fully idempotent: safe to call repeatedly on retries without duplicating alerts.
 */
export async function processSingleTransaction(
  txIdOrData: string | TransactionData,
): Promise<{
  transaction_id: string;
  result: ProcessResult;
  status: 'evaluated' | 'already_processed';
}> {
  let transaction: TransactionData;

  if (typeof txIdOrData === 'string') {
    const row = await db('transactions').where({ id: txIdOrData }).first();
    if (!row) {
      throw new Error(`Transaction ${txIdOrData} not found`);
    }

    transaction = {
      id: row.id,
      external_id: row.external_id,
      account_id: row.account_id,
      amount: parseFloat(row.amount),
      currency: row.currency,
      country_code: row.country_code,
      channel: row.channel || '',
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      merchant_name: row.merchant_name,
      city: row.city,
      latitude: row.latitude ? parseFloat(row.latitude) : undefined,
      longitude: row.longitude ? parseFloat(row.longitude) : undefined,
      ip_address: row.ip_address,
    };
  } else {
    transaction = txIdOrData;
  }

  // Check if already processed
  const existingAlert = await db('alerts').where({ transaction_id: transaction.id }).first();
  if (existingAlert) {
    return {
      transaction_id: transaction.id,
      result: {
        score: existingAlert.risk_score,
        severity: existingAlert.severity,
        alertId: existingAlert.id,
        triggeredRules: [],
      },
      status: 'already_processed',
    };
  }

  const txRow = await db('transactions').where({ id: transaction.id }).first();
  if (txRow?.processed_at && txRow.status === 'clean') {
    return {
      transaction_id: transaction.id,
      result: {
        score: 0,
        severity: null,
        alertId: null,
        triggeredRules: [],
      },
      status: 'already_processed',
    };
  }

  // Execute rule engine evaluation
  const result = await evaluateAndProcess(transaction);

  return {
    transaction_id: transaction.id,
    result,
    status: 'evaluated',
  };
}

/**
 * Sweeps and processes pending transactions that haven't been evaluated yet.
 * Used by Vercel Cron or manual batch triggers.
 */
export async function processBatchPending(limit = 25): Promise<{
  processed: number;
  flagged: number;
  clean: number;
  transactions: Array<{ id: string; score: number; severity: string | null; alert_id: string | null }>;
}> {
  const pendingRows = await db('transactions')
    .whereNull('processed_at')
    .orderBy('created_at', 'asc')
    .limit(limit);

  let flagged = 0;
  let clean = 0;
  const results = [];

  for (const row of pendingRows) {
    try {
      const outcome = await processSingleTransaction(row.id);
      if (outcome.result.alertId) {
        flagged++;
      } else {
        clean++;
      }

      results.push({
        id: row.id,
        score: outcome.result.score,
        severity: outcome.result.severity,
        alert_id: outcome.result.alertId,
      });
    } catch (err) {
      console.error(`[Engine] Batch failed on transaction ${row.id}:`, err);
    }
  }

  return {
    processed: results.length,
    flagged,
    clean,
    transactions: results,
  };
}
