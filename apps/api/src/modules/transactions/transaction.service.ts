// apps/api/src/modules/transactions/transaction.service.ts
// Business logic for transaction operations

import { db } from '../../config/database';
import { redisClient, redisPublisher } from '../../config/redis';
import { CreateTransactionInput } from './transaction.schema';

const TX_STREAM = 'tx:incoming';
const TX_PUBSUB = 'tx:live';

// ─────────────────────────────────────────
// Ingest a new transaction (FS-04 — unchanged)
// ─────────────────────────────────────────
export async function ingestTransaction(input: CreateTransactionInput) {
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
      status: 'clean',
    })
    .returning('*');

  await redisClient.xadd(
    TX_STREAM, '*',
    'id', transaction.id,
    'external_id', transaction.external_id,
    'account_id', transaction.account_id,
    'amount', transaction.amount.toString(),
    'currency', transaction.currency,
    'country_code', transaction.country_code,
    'channel', transaction.channel || '',
    'created_at', transaction.created_at.toISOString(),
  );

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

  await db('audit_logs').insert({
    event_type: 'transaction.ingested',
    actor_type: 'api',
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
// List transactions with filters and pagination (FS-05)
// ─────────────────────────────────────────
export interface ListTransactionsFilters {
  status?: string;
  min_amount?: number;
  max_amount?: number;
  country_code?: string;
  account_id?: string;
  channel?: string;
  page?: number;
  limit?: number;
  sort?: string;
}

export async function listTransactions(filters: ListTransactionsFilters) {
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(filters.limit || 25, 100); // hard cap at 100
  const offset = (page - 1) * limit;

  // Build base query
  // .clone() later lets us reuse the same filters for the COUNT query
  let query = db('transactions');

  // Apply filters only when they are provided
  // This builds a WHERE clause dynamically
  if (filters.status) {
    query = query.where('status', filters.status);
  }
  if (filters.min_amount !== undefined) {
    query = query.where('amount', '>=', filters.min_amount);
  }
  if (filters.max_amount !== undefined) {
    query = query.where('amount', '<=', filters.max_amount);
  }
  if (filters.country_code) {
    query = query.where('country_code', filters.country_code.toUpperCase());
  }
  if (filters.account_id) {
    query = query.where('account_id', filters.account_id);
  }
  if (filters.channel) {
    query = query.where('channel', filters.channel);
  }

  // Run COUNT query using the same filters
  // .clone() copies the query without the ORDER BY / LIMIT / OFFSET
  // which would make COUNT behave unexpectedly
  const [{ count }] = await query
    .clone()
    .count('id as count');
  const total = parseInt(count as string, 10);

  // Parse sort parameter — "created_at:desc" → field=created_at, direction=desc
  const sortParam = filters.sort || 'created_at:desc';
  const [sortField, sortDir] = sortParam.split(':');

  // Whitelist allowed sort fields — prevents SQL injection via sort parameter
  const allowedFields = ['created_at', 'amount', 'account_id', 'status'];
  const field = allowedFields.includes(sortField) ? sortField : 'created_at';
  const direction = sortDir === 'asc' ? 'asc' : 'desc';

  const data = await query
    .orderBy(field, direction)
    .limit(limit)
    .offset(offset)
    .select('*');

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

// ─────────────────────────────────────────
// Get single transaction with enriched data (FS-05)
// Returns: transaction + its alerts + last 10 transactions from same account
// ─────────────────────────────────────────
export async function getTransactionById(id: string) {
  // Fetch the transaction itself
  const transaction = await db('transactions')
    .where({ id })
    .first();

  if (!transaction) {
    return null;
  }

  // Fetch related alerts for this transaction
  // A transaction can have multiple alerts if multiple rules fire
  // We also join alert_rules to get which rules triggered
  const alerts = await db('alerts')
    .where('transaction_id', id)
    .orderBy('risk_score', 'desc')
    .select('*');

  // For each alert, fetch which rules triggered it
  // This gives us the "why was this flagged" data for the UI
  const alertsWithRules = await Promise.all(
    alerts.map(async (alert) => {
      const triggeredRules = await db('alert_rules')
        .join('rules', 'alert_rules.rule_id', 'rules.id')
        .where('alert_rules.alert_id', alert.id)
        .select(
          'alert_rules.score_contribution',
          'alert_rules.details',
          'rules.name',
          'rules.type',
          'rules.severity'
        );
      return { ...alert, triggered_rules: triggeredRules };
    })
  );

  // Fetch the last 10 transactions from the same account
  // Excludes the current transaction (WHERE id != current id)
  // Used by the account timeline on the transaction detail page
  const accountHistory = await db('transactions')
    .where('account_id', transaction.account_id)
    .whereNot('id', id)                     // exclude current transaction
    .orderBy('created_at', 'desc')
    .limit(10)
    .select(
      'id',
      'amount',
      'currency',
      'merchant_name',
      'country_code',
      'channel',
      'status',
      'created_at'
    );

  return {
    ...transaction,
    alerts: alertsWithRules,
    account_history: accountHistory,
  };
}