// apps/api/src/modules/transactions/transaction.service.ts
// Business logic for transaction operations
// This layer handles: DB writes, Redis stream, pub/sub, audit logs
// It does NOT know about HTTP (no req/res objects here)

import { db } from '../../config/database';
import { redisClient, redisPublisher } from '../../config/redis';
import { CreateTransactionInput } from './transaction.schema';

// ─────────────────────────────────────────
// Redis channel and stream names
// Defined as constants so they're consistent everywhere
// ─────────────────────────────────────────
const TX_STREAM = 'tx:incoming';    // Redis Stream — worker reads from here
const TX_PUBSUB = 'tx:live';       // Redis PubSub — dashboard subscribes to this

export async function ingestTransaction(input: CreateTransactionInput) {
  // ─────────────────────────────────────────
  // Step 1: Insert into PostgreSQL
  // ─────────────────────────────────────────
  // knex insert returns an array of inserted rows
  // We request all columns back with returning('*')
  const [transaction] = await db('transactions')
    .insert({
      external_id: input.external_id,
      account_id: input.account_id,
      amount: input.amount,
      currency: input.currency,
      merchant_name: input.merchant_name || null,
      merchant_category: input.merchant_category || null,
      country_code: input.country_code,
      city: input.city || null,
      ip_address: input.ip_address || null,
      latitude: input.latitude || null,
      longitude: input.longitude || null,
      channel: input.channel || null,
      status: 'clean', // always starts clean — worker changes to 'flagged' if needed
    })
    .returning('*'); // return the full inserted row (including generated id and created_at)

  // ─────────────────────────────────────────
  // Step 2: Push to Redis Stream (tx:incoming)
  // ─────────────────────────────────────────
  // XADD adds a message to a stream
  // '*' tells Redis to auto-generate the message ID (timestamp-based)
  // The worker (Sprint 2) reads from this stream and evaluates fraud rules
  //
  // Redis Streams are like a persistent log — messages stay until acknowledged
  // Unlike pub/sub, if the worker is down, messages wait for it to come back
  await redisClient.xadd(
    TX_STREAM,          // stream name
    '*',                // auto-generate message ID
    'id', transaction.id,
    'external_id', transaction.external_id,
    'account_id', transaction.account_id,
    'amount', transaction.amount.toString(),
    'currency', transaction.currency,
    'country_code', transaction.country_code,
    'channel', transaction.channel || '',
    'created_at', transaction.created_at.toISOString(),
  );
  // Note: Redis Stream values must be strings — numbers get converted above

  // ─────────────────────────────────────────
  // Step 3: Publish to Redis PubSub (tx:live)
  // ─────────────────────────────────────────
  // PUBLISH broadcasts a message to all current subscribers
  // The WebSocket server (Sprint 3) subscribes to this channel
  // and forwards messages to connected dashboard clients
  //
  // Unlike Streams, PubSub is fire-and-forget:
  // if nobody is subscribed right now, the message is lost
  // That's fine for the live feed — it's real-time, not historical
  await redisPublisher.publish(
    TX_PUBSUB,
    JSON.stringify({
      id: transaction.id,
      account_id: transaction.account_id,
      amount: transaction.amount,
      currency: transaction.currency,
      merchant_name: transaction.merchant_name,
      country_code: transaction.country_code,
      channel: transaction.channel,
      status: 'clean',
      created_at: transaction.created_at,
    })
  );

  // ─────────────────────────────────────────
  // Step 4: Write to audit_logs
  // ─────────────────────────────────────────
  // Every ingested transaction is logged
  // This creates an immutable record: "at this time, this transaction came in"
  // Useful for debugging, compliance, and "what happened?" investigations
  await db('audit_logs').insert({
    event_type: 'transaction.ingested',
    actor_type: 'api',            // came in via API key, not a human user
    target_type: 'transaction',
    target_id: transaction.id,
    payload: JSON.stringify({
      external_id: transaction.external_id,
      account_id: transaction.account_id,
      amount: transaction.amount,
    }),
    source: 'api',
  });

  return transaction;
}

// ─────────────────────────────────────────
// Get a single transaction by ID
// Used by the transaction detail page
// ─────────────────────────────────────────
export async function getTransactionById(id: string) {
  const transaction = await db('transactions').where({ id }).first();
  return transaction || null;
}

// ─────────────────────────────────────────
// List transactions with filters and pagination
// Used by the transactions list page
// ─────────────────────────────────────────
export async function listTransactions(filters: {
  status?: string;
  min_amount?: number;
  max_amount?: number;
  country_code?: string;
  account_id?: string;
  channel?: string;
  page?: number;
  limit?: number;
  sort?: string;
}) {
  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 25, 100); // cap at 100
  const offset = (page - 1) * limit;

  // Build the query dynamically based on which filters are provided
  // knex's chaining API lets you add conditions only when needed
  let query = db('transactions');

  if (filters.status) query = query.where('status', filters.status);
  if (filters.min_amount) query = query.where('amount', '>=', filters.min_amount);
  if (filters.max_amount) query = query.where('amount', '<=', filters.max_amount);
  if (filters.country_code) query = query.where('country_code', filters.country_code);
  if (filters.account_id) query = query.where('account_id', filters.account_id);
  if (filters.channel) query = query.where('channel', filters.channel);

  // Count total matching rows (for pagination metadata)
  const [{ count }] = await query.clone().count('id as count');
  const total = parseInt(count as string, 10);

  // Parse sort parameter — format is "field:direction" e.g. "created_at:desc"
  const [sortField, sortDir] = (filters.sort || 'created_at:desc').split(':');
  const allowedSortFields = ['created_at', 'amount', 'account_id'];
  const field = allowedSortFields.includes(sortField) ? sortField : 'created_at';
  const direction = sortDir === 'asc' ? 'asc' : 'desc';

  const data = await query
    .orderBy(field, direction)
    .limit(limit)
    .offset(offset);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}