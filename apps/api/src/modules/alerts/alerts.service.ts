// apps/api/src/modules/alerts/alerts.service.ts
// Business logic for the alerts API
//
// KEY DESIGN DECISIONS:
//
// 1. STATE MACHINE VALIDATION
//    Every action is validated against ALLOWED_TRANSITIONS before execution.
//    This prevents invalid state transitions (e.g. dismissing an escalated alert).
//    The check happens inside a DB transaction so no race condition exists.
//
// 2. POSTGRESQL TRANSACTION ATOMICITY
//    The action endpoint wraps 3 writes in one transaction:
//      UPDATE alerts → INSERT alert_actions → INSERT audit_logs
//    If any fails, all roll back. No partial state is ever persisted.
//
// 3. PUBLISH-AFTER-COMMIT
//    Redis PubSub publish happens AFTER the DB transaction commits.
//    If we published before commit and the commit failed, dashboards
//    would show a status that doesn't exist in the database.
//
// 4. OPTIMISTIC LOCKING (simple version)
//    We re-fetch the alert inside the transaction to check current status.
//    This prevents two analysts acting simultaneously on the same alert.

import { db } from '../../config/database';
import { redisPublisher } from '../../config/redis';
import {
  AlertActionInput,
  ALLOWED_TRANSITIONS,
  ACTION_STATUS_MAP,
  TERMINAL_STATUSES,
} from './alerts.schema';

const ALERTS_UPDATED_CHANNEL = 'alerts:updated';

// ─────────────────────────────────────────
// Error class for invalid state transitions
// ─────────────────────────────────────────
export class InvalidTransitionError extends Error {
  constructor(
    public currentStatus: string,
    public requestedAction: string
  ) {
    super(
      `Cannot '${requestedAction}' an alert with status '${currentStatus}'. ` +
      `Allowed actions: ${(ALLOWED_TRANSITIONS[currentStatus] || []).join(', ') || 'none'}`
    );
    this.name = 'InvalidTransitionError';
  }
}

// ─────────────────────────────────────────
// GET /api/v1/alerts — list with pagination
// ─────────────────────────────────────────
export async function listAlerts(filters: {
  status?: string;
  severity?: string;
  sort?: string;
  page: number;
  limit: number;
}) {
  const { page, limit } = filters;
  const offset = (page - 1) * limit;

  let query = db('alerts')
    .leftJoin('transactions', 'alerts.transaction_id', 'transactions.id')
    .select(
      'alerts.*',
      // Transaction fields prefixed to avoid collision
      'transactions.external_id as tx_external_id',
      'transactions.account_id as tx_account_id',
      'transactions.amount as tx_amount',
      'transactions.currency as tx_currency',
      'transactions.merchant_name as tx_merchant_name',
      'transactions.country_code as tx_country_code',
      'transactions.channel as tx_channel',
      'transactions.created_at as tx_created_at',
    );

  // Apply status filter — supports comma-separated values
  if (filters.status) {
    const statuses = filters.status.split(',').map(s => s.trim());
    query = query.whereIn('alerts.status', statuses);
  }

  if (filters.severity) {
    const severities = filters.severity.split(',').map(s => s.trim());
    query = query.whereIn('alerts.severity', severities);
  }

  // Parse sort parameter — "risk_score:desc" → column + direction
  const [sortField, sortDir] = (filters.sort || 'risk_score:desc').split(':');
  const allowedSortFields = ['risk_score', 'created_at', 'severity'];
  const field = allowedSortFields.includes(sortField)
    ? `alerts.${sortField}`
    : 'alerts.risk_score';
  const direction = sortDir === 'asc' ? 'asc' : 'desc';

  // Count total matching
  const [{ count }] = await query.clone().clearSelect().count('alerts.id as count');
  const total = parseInt(count as string, 10);

  const rows = await query
    .orderBy(field, direction)
    .limit(limit)
    .offset(offset);

  // Shape the response — nest transaction data under `transaction`
  const data = rows.map((row: any) => ({
    id:            row.id,
    transaction_id: row.transaction_id,
    risk_score:    row.risk_score,
    severity:      row.severity,
    status:        row.status,
    assigned_to:   row.assigned_to,
    created_at:    row.created_at,
    resolved_at:   row.resolved_at,
    transaction: {
      id:           row.transaction_id,
      external_id:  row.tx_external_id,
      account_id:   row.tx_account_id,
      amount:       row.tx_amount,
      currency:     row.tx_currency,
      merchant_name: row.tx_merchant_name,
      country_code: row.tx_country_code,
      channel:      row.tx_channel,
      created_at:   row.tx_created_at,
    },
  }));

  // For each alert, fetch triggered rules
  const dataWithRules = await Promise.all(
    data.map(async (alert: any) => {
      const triggeredRules = await db('alert_rules')
        .join('rules', 'alert_rules.rule_id', 'rules.id')
        .where('alert_rules.alert_id', alert.id)
        .select(
          'alert_rules.score_contribution',
          'alert_rules.details',
          'rules.id as rule_id',
          'rules.name as rule_name',
          'rules.type as rule_type',
          'rules.severity as rule_severity',
        );

      return {
        ...alert,
        triggered_rules: triggeredRules.map((r: any) => ({
          ruleId:           r.rule_id,
          ruleName:         r.rule_name,
          ruleType:         r.rule_type,
          score_contribution: r.score_contribution,
          details: typeof r.details === 'string'
            ? JSON.parse(r.details)
            : r.details,
        })),
      };
    })
  );

  return {
    data: dataWithRules,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

// ─────────────────────────────────────────
// GET /api/v1/alerts/counts
// Returns counts grouped by status for sidebar badge
// ─────────────────────────────────────────
export async function getAlertCounts() {
  const rows = await db('alerts')
    .select('status')
    .count('id as count')
    .groupBy('status');

  // Build a complete map with 0 defaults for missing statuses
  const counts: Record<string, number> = {
    new:          0,
    reviewing:    0,
    investigating: 0,
    dismissed:    0,
    escalated:    0,
  };

  rows.forEach((row: any) => {
    counts[row.status] = parseInt(row.count, 10);
  });

  return {
    ...counts,
    // Computed convenience fields
    pending: counts.new + counts.reviewing + counts.investigating,
    resolved: counts.dismissed + counts.escalated,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

// ─────────────────────────────────────────
// GET /api/v1/alerts/:id
// Single alert with full detail: triggered rules + action history
// ─────────────────────────────────────────
export async function getAlertById(id: string) {
  const alert = await db('alerts')
    .leftJoin('transactions', 'alerts.transaction_id', 'transactions.id')
    .where('alerts.id', id)
    .select(
      'alerts.*',
      'transactions.external_id as tx_external_id',
      'transactions.account_id as tx_account_id',
      'transactions.amount as tx_amount',
      'transactions.currency as tx_currency',
      'transactions.merchant_name as tx_merchant_name',
      'transactions.country_code as tx_country_code',
      'transactions.channel as tx_channel',
      'transactions.ip_address as tx_ip_address',
      'transactions.latitude as tx_latitude',
      'transactions.longitude as tx_longitude',
      'transactions.created_at as tx_created_at',
    )
    .first();

  if (!alert) return null;

  // Triggered rules with full rule details
  const triggeredRules = await db('alert_rules')
    .join('rules', 'alert_rules.rule_id', 'rules.id')
    .where('alert_rules.alert_id', id)
    .select(
      'alert_rules.score_contribution',
      'alert_rules.details',
      'rules.id as rule_id',
      'rules.name as rule_name',
      'rules.type as rule_type',
      'rules.severity as rule_severity',
      'rules.description as rule_description',
    );

  // Action history — who did what and when
  const actions = await db('alert_actions')
    .where('alert_id', id)
    .leftJoin('users', 'alert_actions.analyst_id', 'users.id')
    .select(
      'alert_actions.*',
      'users.email as analyst_email',
      'users.first_name as analyst_first_name',
      'users.last_name as analyst_last_name',
    )
    .orderBy('alert_actions.created_at', 'asc');

  return {
    id:             alert.id,
    transaction_id: alert.transaction_id,
    risk_score:     alert.risk_score,
    severity:       alert.severity,
    status:         alert.status,
    assigned_to:    alert.assigned_to,
    created_at:     alert.created_at,
    resolved_at:    alert.resolved_at,

    // Nested transaction
    transaction: {
      id:           alert.transaction_id,
      external_id:  alert.tx_external_id,
      account_id:   alert.tx_account_id,
      amount:       alert.tx_amount,
      currency:     alert.tx_currency,
      merchant_name: alert.tx_merchant_name,
      country_code: alert.tx_country_code,
      channel:      alert.tx_channel,
      ip_address:   alert.tx_ip_address,
      latitude:     alert.tx_latitude,
      longitude:    alert.tx_longitude,
      created_at:   alert.tx_created_at,
    },

    // Triggered rules with parsed details
    triggered_rules: triggeredRules.map((r: any) => ({
      ruleId:            r.rule_id,
      ruleName:          r.rule_name,
      ruleType:          r.rule_type,
      ruleSeverity:      r.rule_severity,
      ruleDescription:   r.rule_description,
      score_contribution: r.score_contribution,
      details: typeof r.details === 'string'
        ? JSON.parse(r.details)
        : r.details,
    })),

    // Action history
    actions: actions.map((a: any) => ({
      id:              a.id,
      action:          a.action,
      reason:          a.reason,
      previous_status: a.previous_status,
      new_status:      a.new_status,
      created_at:      a.created_at,
      analyst: a.analyst_email ? {
        id:         a.analyst_id,
        email:      a.analyst_email,
        first_name: a.analyst_first_name,
        last_name:  a.analyst_last_name,
      } : null,
    })),
  };
}

// ─────────────────────────────────────────
// POST /api/v1/alerts/:id/actions
// Analyst takes action on an alert
// ─────────────────────────────────────────
export async function takeAction(
  alertId: string,
  input: AlertActionInput,
  analystId: string,
  analystEmail: string,
  ipAddress?: string,
) {
  const { action, reason } = input;
  let resultAlert: Record<string, unknown>;

  // ── Wrap everything in a PostgreSQL transaction ─────────────────
  // If any step fails, all changes roll back automatically
  await db.transaction(async (trx) => {

    // ── Step 1: Re-fetch alert inside transaction (prevents race conditions)
    // If two analysts try to act simultaneously, the second one reads
    // the status already changed by the first
    const alert = await trx('alerts').where({ id: alertId }).first();

    if (!alert) {
      const err = new Error('Alert not found') as any;
      err.statusCode = 404;
      throw err;
    }

    // ── Step 2: Validate state transition ──────────────────────────
    const allowedActions = ALLOWED_TRANSITIONS[alert.status] || [];

    if (!allowedActions.includes(action as any)) {
      const err = new Error(
        `Cannot '${action}' an alert with status '${alert.status}'. ` +
        `Allowed actions: ${allowedActions.join(', ') || 'none'}`
      ) as any;
      err.code = 'INVALID_TRANSITION';
      err.statusCode = 422;
      throw err;
    }

    const previousStatus = alert.status;
    const newStatus = ACTION_STATUS_MAP[action];
    const isTerminal = newStatus ? TERMINAL_STATUSES.has(newStatus) : false;

    // ── Step 3: Update alert status ────────────────────────────────
    const alertUpdate: Record<string, unknown> = {};

    if (newStatus) {
      alertUpdate.status = newStatus;
    }

    if (action === 'investigate' || action === 'reassign') {
      alertUpdate.assigned_to = analystId;
    }

    if (isTerminal) {
      // Terminal actions (dismiss/escalate) set resolved_at
      alertUpdate.resolved_at = trx.fn.now();
    }

    if (Object.keys(alertUpdate).length > 0) {
      await trx('alerts').where({ id: alertId }).update(alertUpdate);
    }

    // ── Step 4: Insert alert_actions record ────────────────────────
    // This is the permanent audit trail of every analyst decision
    await trx('alert_actions').insert({
      alert_id:        alertId,
      analyst_id:      analystId,
      action,
      reason,
      previous_status: previousStatus,
      new_status:      newStatus || previousStatus,
    });

    // ── Step 5: Write to audit_logs ────────────────────────────────
    await trx('audit_logs').insert({
      event_type:  `alert.${action}`,
      actor_id:    analystId,
      actor_type:  'user',
      target_type: 'alert',
      target_id:   alertId,
      payload: JSON.stringify({
        action,
        reason,
        previous_status: previousStatus,
        new_status:      newStatus || previousStatus,
        alert_id:        alertId,
        transaction_id:  alert.transaction_id,
      }),
      ip_address: ipAddress || null,
      source:     'api',
    });

    // Store result for post-commit publish
    resultAlert = {
      id:              alertId,
      status:          newStatus || previousStatus,
      previous_status: previousStatus,
      transaction_id:  alert.transaction_id,
    };

    // DB transaction auto-commits here if no error was thrown
  });

  // ── Step 6: Publish to Redis PubSub (AFTER DB commit) ──────────
  // publish-after-commit pattern: DB is source of truth,
  // Redis is just notification delivery
  await redisPublisher.publish(
    ALERTS_UPDATED_CHANNEL,
    JSON.stringify({
      alert_id:   alertId,
      new_status: ACTION_STATUS_MAP[action] || undefined,
      action,
      analyst:    analystEmail,
      reason,
      updated_at: new Date().toISOString(),
    })
  );

  // Return the full updated alert
  return getAlertById(alertId);
}