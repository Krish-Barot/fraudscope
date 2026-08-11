// apps/api/src/modules/alerts/alerts.service.ts

import { db } from '../../config/database';
import { redisPublisher } from '../../config/redis';

export interface ListAlertsFilters {
  status?: string;
  severity?: string;
  sort?: string;
  page?: number;
  limit?: number;
}

export async function listAlerts(filters: ListAlertsFilters) {
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(filters.limit || 50, 100);
  const offset = (page - 1) * limit;

  let query = db('alerts');

  // Filter by status (supports comma-separated string)
  if (filters.status) {
    const statuses = filters.status
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (statuses.length > 0) {
      query = query.whereIn('alerts.status', statuses);
    }
  }

  // Filter by severity (supports comma-separated string)
  if (filters.severity) {
    const severities = filters.severity
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (severities.length > 0) {
      query = query.whereIn('alerts.severity', severities);
    }
  }

  // Total matching alerts for pagination
  const [{ count }] = await query.clone().count('alerts.id as count');
  const total = parseInt(count as string, 10);

  // Sorting
  const sortParam = filters.sort || 'risk_score:desc';
  const [sortField, sortDir] = sortParam.split(':');
  const allowedFields = ['risk_score', 'created_at', 'severity', 'status'];
  const field = allowedFields.includes(sortField) ? sortField : 'risk_score';
  const direction = sortDir === 'asc' ? 'asc' : 'desc';

  const alertRows = await query
    .orderBy(`alerts.${field}`, direction)
    .orderBy('alerts.created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .select('alerts.*');

  // Enrich alerts with transaction data & triggered rules
  const enrichedAlerts = await Promise.all(
    alertRows.map(async (alert) => {
      const transaction = await db('transactions')
        .where('id', alert.transaction_id)
        .first();

      const triggeredRulesRaw = await db('alert_rules')
        .join('rules', 'alert_rules.rule_id', 'rules.id')
        .where('alert_rules.alert_id', alert.id)
        .select(
          'rules.id as rule_id',
          'rules.name',
          'rules.type',
          'alert_rules.score_contribution',
          'alert_rules.details'
        );

      const triggered_rules = triggeredRulesRaw.map((r) => ({
        ...r,
        ruleId: r.rule_id,
        ruleName: r.name,
        ruleType: r.type,
      }));

      return {
        ...alert,
        transaction: transaction || undefined,
        triggered_rules,
      };
    })
  );

  // Overall counts for summary metrics
  const countsRaw = await db('alerts')
    .select('severity', 'status')
    .count('id as count')
    .groupBy('severity', 'status');

  const counts = {
    total,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    new: 0,
    reviewing: 0,
    investigating: 0,
    dismissed: 0,
    escalated: 0,
  };

  for (const row of countsRaw) {
    const cnt = parseInt(row.count as string, 10);
    if (row.severity in counts) {
      (counts as any)[row.severity] += cnt;
    }
    if (row.status in counts) {
      (counts as any)[row.status] += cnt;
    }
  }

  return {
    data: enrichedAlerts,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
    counts,
  };
}

export async function getAlertById(alertId: string) {
  const alert = await db('alerts').where('id', alertId).first();
  if (!alert) return null;

  const transaction = await db('transactions')
    .where('id', alert.transaction_id)
    .first();

  const triggeredRulesRaw = await db('alert_rules')
    .join('rules', 'alert_rules.rule_id', 'rules.id')
    .where('alert_rules.alert_id', alert.id)
    .select(
      'rules.id as rule_id',
      'rules.name',
      'rules.type',
      'alert_rules.score_contribution',
      'alert_rules.details'
    );

  const triggered_rules = triggeredRulesRaw.map((r) => ({
    ...r,
    ruleId: r.rule_id,
    ruleName: r.name,
    ruleType: r.type,
  }));

  const actions = await db('alert_actions')
    .where('alert_id', alert.id)
    .orderBy('created_at', 'desc');

  return {
    alert: {
      ...alert,
      transaction,
      triggered_rules,
    },
    transaction,
    triggered_rules,
    actions,
  };
}

export async function takeAlertAction(
  alertId: string,
  analystId: string,
  action: 'dismiss' | 'escalate' | 'investigate',
  reason: string
) {
  const alert = await db('alerts').where('id', alertId).first();
  if (!alert) return null;

  const statusMap: Record<string, string> = {
    dismiss: 'dismissed',
    escalate: 'escalated',
    investigate: 'investigating',
  };

  const newStatus = statusMap[action];

  let actionRecord: any;

  await db.transaction(async (trx) => {
    await trx('alerts')
      .where('id', alertId)
      .update({
        status: newStatus,
        resolved_at: ['dismissed', 'escalated'].includes(newStatus)
          ? trx.fn.now()
          : null,
        assigned_to: analystId,
      });

    [actionRecord] = await trx('alert_actions')
      .insert({
        alert_id: alertId,
        analyst_id: analystId,
        action,
        reason,
        previous_status: alert.status,
        new_status: newStatus,
      })
      .returning('*');

    await trx('audit_logs').insert({
      event_type: `alert.${action}`,
      actor_type: 'user',
      actor_id: analystId,
      target_type: 'alert',
      target_id: alertId,
      payload: JSON.stringify({
        reason,
        previous_status: alert.status,
        new_status: newStatus,
      }),
      source: 'api',
    });
  });

  // Publish Redis update event for WebSocket real-time sync
  try {
    await redisPublisher.publish(
      'alerts:updated',
      JSON.stringify({
        alert_id: alertId,
        status: newStatus,
        analyst_id: analystId,
      })
    );
  } catch (err) {
    console.error('Failed to publish alerts:updated event to Redis:', err);
  }

  const updatedAlert = await getAlertById(alertId);

  return {
    alert: updatedAlert?.alert,
    action: actionRecord,
  };
}

export async function getAlertCounts() {
  const countsRaw = await db('alerts')
    .select('severity', 'status')
    .count('id as count')
    .groupBy('severity', 'status');

  const result = {
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    new: 0,
    reviewing: 0,
    investigating: 0,
    dismissed_today: 0,
    escalated_today: 0,
  };

  for (const row of countsRaw) {
    const cnt = parseInt(row.count as string, 10);
    if (row.severity in result) {
      (result as any)[row.severity] += cnt;
    }
    if (row.status in result) {
      (result as any)[row.status] += cnt;
    }
    result.total += cnt;
  }

  const today = new Date().toISOString().split('T')[0];
  const [{ count: dismissedToday }] = await db('alerts')
    .where('status', 'dismissed')
    .where('resolved_at', '>=', `${today}T00:00:00.000Z`)
    .count('id as count');

  const [{ count: escalatedToday }] = await db('alerts')
    .where('status', 'escalated')
    .where('resolved_at', '>=', `${today}T00:00:00.000Z`)
    .count('id as count');

  result.dismissed_today = parseInt(dismissedToday as string, 10);
  result.escalated_today = parseInt(escalatedToday as string, 10);

  return result;
}
