// apps/api/src/modules/rules/rules.service.ts
// Business logic for the rules API
//
// Key responsibilities:
// 1. CRUD operations on the rules table
// 2. Parameter validation against the specific rule module's parameterSchema
// 3. Stats computation (trigger counts, false positive rate, avg score)
// 4. Audit logging on every state change
// 5. Cache invalidation when rules change

import { db } from '../../config/database';
import { invalidateRuleCache } from '../../engine/scorer';
import { CreateRuleInput, UpdateRuleInput } from './rules.schema';

// Import rule modules for parameter validation
// When a new rule type is added, import it here too
import { parameterSchema as velocitySchema } from '../../engine/rules/velocity';
import { parameterSchema as amountAnomalySchema } from '../../engine/rules/amountAnomaly';
import { parameterSchema as geoMismatchSchema } from '../../engine/rules/geoMismatch';
import { parameterSchema as timeAnomalySchema } from '../../engine/rules/timeAnomaly';
import { parameterSchema as roundAmountSchema } from '../../engine/rules/roundAmount';

// Registry of parameter schemas per rule type
// Keeps the validation logic DRY — same registry pattern as scorer.ts
const PARAMETER_SCHEMAS: Record<string, { parse: (data: unknown) => unknown }> = {
  velocity:       velocitySchema,
  amount_anomaly: amountAnomalySchema,
  geo_mismatch:   geoMismatchSchema,
  time_anomaly:   timeAnomalySchema,
  round_amount:   roundAmountSchema,
};

// ─────────────────────────────────────────
// Validate rule parameters against the specific rule module's schema
// Throws ZodError if parameters are invalid for the given rule type
// Called on create and update
// ─────────────────────────────────────────
export function validateRuleParameters(
  type: string,
  parameters: Record<string, unknown>
): void {
  const schema = PARAMETER_SCHEMAS[type];
  if (!schema) {
    throw new Error(`Unknown rule type: ${type}`);
  }
  // This throws ZodError if validation fails
  // The controller catches ZodError and returns 400
  schema.parse(parameters);
}

// ─────────────────────────────────────────
// Write to audit_logs — called on every state change
// ─────────────────────────────────────────
async function writeAuditLog(
  eventType: string,
  ruleId: string,
  actorId: string | undefined,
  payload: Record<string, unknown>,
  trx?: any
): Promise<void> {
  const query = trx ? trx('audit_logs') : db('audit_logs');
  await query.insert({
    event_type: eventType,
    actor_id: actorId || null,
    actor_type: 'user',
    target_type: 'rule',
    target_id: ruleId,
    payload: JSON.stringify(payload),
    source: 'api',
  });
}

// ─────────────────────────────────────────
// Compute 7-day hit count for a rule
// Used in the list endpoint to show rule activity at a glance
// ─────────────────────────────────────────
async function getRuleHitCount(ruleId: string): Promise<number> {
  const result = await db('alert_rules')
    .join('alerts', 'alert_rules.alert_id', 'alerts.id')
    .where('alert_rules.rule_id', ruleId)
    .where('alerts.created_at', '>=', db.raw("NOW() - INTERVAL '7 days'"))
    .count('alert_rules.id as count')
    .first();

  return parseInt(result?.count as string || '0', 10);
}

// ─────────────────────────────────────────
// Compute detailed stats for a single rule
// Used in the detail endpoint
// ─────────────────────────────────────────
async function getRuleStats(ruleId: string) {
  // Total alerts this rule has contributed to (all time)
  const triggerResult = await db('alert_rules')
    .where('rule_id', ruleId)
    .count('id as count')
    .first();
  const trigger_count = parseInt(triggerResult?.count as string || '0', 10);

  // False positive rate = dismissed alerts / total alerts for this rule
  const dismissedResult = await db('alert_rules')
    .join('alerts', 'alert_rules.alert_id', 'alerts.id')
    .where('alert_rules.rule_id', ruleId)
    .where('alerts.status', 'dismissed')
    .count('alert_rules.id as count')
    .first();
  const dismissed_count = parseInt(dismissedResult?.count as string || '0', 10);

  const false_positive_rate = trigger_count > 0
    ? Math.round((dismissed_count / trigger_count) * 100) / 100
    : 0;

  // Average risk score of alerts this rule contributed to
  const avgResult = await db('alert_rules')
    .join('alerts', 'alert_rules.alert_id', 'alerts.id')
    .where('alert_rules.rule_id', ruleId)
    .avg('alerts.risk_score as avg')
    .first();
  const avg_score = avgResult?.avg
    ? Math.round(parseFloat(avgResult.avg as string) * 100) / 100
    : 0;

  // When did this rule last trigger?
  const lastResult = await db('alert_rules')
    .join('alerts', 'alert_rules.alert_id', 'alerts.id')
    .where('alert_rules.rule_id', ruleId)
    .orderBy('alerts.created_at', 'desc')
    .select('alerts.created_at')
    .first();
  const last_triggered = lastResult?.created_at || null;

  return {
    trigger_count,
    false_positive_rate,
    avg_score,
    last_triggered,
  };
}

// ─────────────────────────────────────────
// GET /api/v1/rules — list all rules with 7-day hit count
// ─────────────────────────────────────────
export async function listRules(filters: {
  type?: string;
  severity?: string;
  is_active?: boolean;
}) {
  let query = db('rules').select('*');

  if (filters.type) query = query.where('type', filters.type);
  if (filters.severity) query = query.where('severity', filters.severity);
  if (filters.is_active !== undefined) {
    query = query.where('is_active', filters.is_active);
  }

  const rules = await query.orderBy('created_at', 'asc');

  // Add 7-day hit count to each rule
  // Run hit count queries in parallel for performance
  const rulesWithHitCount = await Promise.all(
    rules.map(async (rule: any) => ({
      ...rule,
      parameters: typeof rule.parameters === 'string'
        ? JSON.parse(rule.parameters)
        : rule.parameters,
      hit_count_7d: await getRuleHitCount(rule.id),
    }))
  );

  return rulesWithHitCount;
}

// ─────────────────────────────────────────
// GET /api/v1/rules/:id — single rule with full stats
// ─────────────────────────────────────────
export async function getRuleById(id: string) {
  const rule = await db('rules').where({ id }).first();
  if (!rule) return null;

  const stats = await getRuleStats(id);

  return {
    ...rule,
    parameters: typeof rule.parameters === 'string'
      ? JSON.parse(rule.parameters)
      : rule.parameters,
    stats,
  };
}

// ─────────────────────────────────────────
// POST /api/v1/rules — create a new rule
// ─────────────────────────────────────────
export async function createRule(
  input: CreateRuleInput,
  actorId: string
) {
  // Validate parameters against the specific rule module's schema
  // Throws ZodError if invalid — controller handles this
  validateRuleParameters(input.type, input.parameters);

  const [rule] = await db('rules').insert({
    name: input.name,
    description: input.description || null,
    type: input.type,
    parameters: JSON.stringify(input.parameters),
    severity: input.severity,
    score_weight: input.score_weight,
    is_active: input.is_active,
    created_by: actorId,
  }).returning('*');

  await writeAuditLog('rule.created', rule.id, actorId, {
    name: rule.name,
    type: rule.type,
    severity: rule.severity,
    is_active: rule.is_active,
  });

  // New rule should take effect immediately
  invalidateRuleCache();

  return {
    ...rule,
    parameters: typeof rule.parameters === 'string'
      ? JSON.parse(rule.parameters)
      : rule.parameters,
  };
}

// ─────────────────────────────────────────
// PUT /api/v1/rules/:id — full update (replace)
// ─────────────────────────────────────────
export async function updateRule(
  id: string,
  input: UpdateRuleInput,
  actorId: string
) {
  const existing = await db('rules').where({ id }).first();
  if (!existing) return null;

  // Re-validate parameters — type might have changed
  validateRuleParameters(input.type, input.parameters);

  const [rule] = await db('rules')
    .where({ id })
    .update({
      name: input.name,
      description: input.description || null,
      type: input.type,
      parameters: JSON.stringify(input.parameters),
      severity: input.severity,
      score_weight: input.score_weight,
      is_active: input.is_active,
      updated_at: db.fn.now(),
    })
    .returning('*');

  await writeAuditLog('rule.updated', id, actorId, {
    previous: {
      name: existing.name,
      type: existing.type,
      severity: existing.severity,
      is_active: existing.is_active,
    },
    updated: {
      name: rule.name,
      type: rule.type,
      severity: rule.severity,
      is_active: rule.is_active,
    },
  });

  // Changes take effect immediately
  invalidateRuleCache();

  return {
    ...rule,
    parameters: typeof rule.parameters === 'string'
      ? JSON.parse(rule.parameters)
      : rule.parameters,
  };
}

// ─────────────────────────────────────────
// PATCH /api/v1/rules/:id/toggle — flip is_active
// Separate endpoint because this is the most common operation
// and we want to invalidate the cache immediately
// ─────────────────────────────────────────
export async function toggleRule(
  id: string,
  is_active: boolean,
  actorId: string
) {
  const existing = await db('rules').where({ id }).first();
  if (!existing) return null;

  const [rule] = await db('rules')
    .where({ id })
    .update({
      is_active,
      updated_at: db.fn.now(),
    })
    .returning('*');

  await writeAuditLog('rule.toggled', id, actorId, {
    previous_is_active: existing.is_active,
    new_is_active: is_active,
    name: rule.name,
  });

  // IMMEDIATELY invalidate the rule cache
  // Unlike the 60s TTL, a toggled rule must take effect within seconds
  // because an admin toggling a rule off is usually reacting to a problem
  invalidateRuleCache();

  return {
    ...rule,
    parameters: typeof rule.parameters === 'string'
      ? JSON.parse(rule.parameters)
      : rule.parameters,
  };
}

// ─────────────────────────────────────────
// DELETE /api/v1/rules/:id
// Guard: refuse deletion if rule has >= 10 associated alerts
// This prevents accidental deletion of rules with significant history
// ─────────────────────────────────────────
export async function deleteRule(
  id: string,
  actorId: string
): Promise<{ deleted: boolean; alertCount?: number }> {
  const existing = await db('rules').where({ id }).first();
  if (!existing) return { deleted: false };

  // Count total alerts this rule has contributed to
  const result = await db('alert_rules')
    .where('rule_id', id)
    .count('id as count')
    .first();
  const alertCount = parseInt(result?.count as string || '0', 10);

  // Refuse deletion if rule has significant history
  if (alertCount >= 10) {
    return { deleted: false, alertCount };
  }

  await db.transaction(async (trx) => {
    await trx('alert_rules').where({ rule_id: id }).delete();
    await writeAuditLog('rule.deleted', id, actorId, {
      name: existing.name,
      type: existing.type,
      alert_count_at_deletion: alertCount,
    }, trx);
    await trx('rules').where({ id }).delete();
  });

  // Rule gone — invalidate cache so worker stops using it
  invalidateRuleCache();

  return { deleted: true, alertCount };
}