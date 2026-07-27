"use strict";
// apps/api/src/modules/rules/rules.service.ts
// Business logic for the rules API
//
// Key responsibilities:
// 1. CRUD operations on the rules table
// 2. Parameter validation against the specific rule module's parameterSchema
// 3. Stats computation (trigger counts, false positive rate, avg score)
// 4. Audit logging on every state change
// 5. Cache invalidation when rules change
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRuleParameters = validateRuleParameters;
exports.listRules = listRules;
exports.getRuleById = getRuleById;
exports.createRule = createRule;
exports.updateRule = updateRule;
exports.toggleRule = toggleRule;
exports.deleteRule = deleteRule;
const database_1 = require("../../config/database");
const scorer_1 = require("../../engine/scorer");
// Import rule modules for parameter validation
// When a new rule type is added, import it here too
const velocity_1 = require("../../engine/rules/velocity");
const amountAnomaly_1 = require("../../engine/rules/amountAnomaly");
const geoMismatch_1 = require("../../engine/rules/geoMismatch");
const timeAnomaly_1 = require("../../engine/rules/timeAnomaly");
const roundAmount_1 = require("../../engine/rules/roundAmount");
// Registry of parameter schemas per rule type
// Keeps the validation logic DRY — same registry pattern as scorer.ts
const PARAMETER_SCHEMAS = {
    velocity: velocity_1.parameterSchema,
    amount_anomaly: amountAnomaly_1.parameterSchema,
    geo_mismatch: geoMismatch_1.parameterSchema,
    time_anomaly: timeAnomaly_1.parameterSchema,
    round_amount: roundAmount_1.parameterSchema,
};
// ─────────────────────────────────────────
// Validate rule parameters against the specific rule module's schema
// Throws ZodError if parameters are invalid for the given rule type
// Called on create and update
// ─────────────────────────────────────────
function validateRuleParameters(type, parameters) {
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
async function writeAuditLog(eventType, ruleId, actorId, payload) {
    await (0, database_1.db)('audit_logs').insert({
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
async function getRuleHitCount(ruleId) {
    const result = await (0, database_1.db)('alert_rules')
        .join('alerts', 'alert_rules.alert_id', 'alerts.id')
        .where('alert_rules.rule_id', ruleId)
        .where('alerts.created_at', '>=', database_1.db.raw("NOW() - INTERVAL '7 days'"))
        .count('alert_rules.id as count')
        .first();
    return parseInt(result?.count || '0', 10);
}
// ─────────────────────────────────────────
// Compute detailed stats for a single rule
// Used in the detail endpoint
// ─────────────────────────────────────────
async function getRuleStats(ruleId) {
    // Total alerts this rule has contributed to (all time)
    const triggerResult = await (0, database_1.db)('alert_rules')
        .where('rule_id', ruleId)
        .count('id as count')
        .first();
    const trigger_count = parseInt(triggerResult?.count || '0', 10);
    // False positive rate = dismissed alerts / total alerts for this rule
    const dismissedResult = await (0, database_1.db)('alert_rules')
        .join('alerts', 'alert_rules.alert_id', 'alerts.id')
        .where('alert_rules.rule_id', ruleId)
        .where('alerts.status', 'dismissed')
        .count('alert_rules.id as count')
        .first();
    const dismissed_count = parseInt(dismissedResult?.count || '0', 10);
    const false_positive_rate = trigger_count > 0
        ? Math.round((dismissed_count / trigger_count) * 100) / 100
        : 0;
    // Average risk score of alerts this rule contributed to
    const avgResult = await (0, database_1.db)('alert_rules')
        .join('alerts', 'alert_rules.alert_id', 'alerts.id')
        .where('alert_rules.rule_id', ruleId)
        .avg('alerts.risk_score as avg')
        .first();
    const avg_score = avgResult?.avg
        ? Math.round(parseFloat(avgResult.avg) * 100) / 100
        : 0;
    // When did this rule last trigger?
    const lastResult = await (0, database_1.db)('alert_rules')
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
async function listRules(filters) {
    let query = (0, database_1.db)('rules').select('*');
    if (filters.type)
        query = query.where('type', filters.type);
    if (filters.severity)
        query = query.where('severity', filters.severity);
    if (filters.is_active !== undefined) {
        query = query.where('is_active', filters.is_active);
    }
    const rules = await query.orderBy('created_at', 'asc');
    // Add 7-day hit count to each rule
    // Run hit count queries in parallel for performance
    const rulesWithHitCount = await Promise.all(rules.map(async (rule) => ({
        ...rule,
        parameters: typeof rule.parameters === 'string'
            ? JSON.parse(rule.parameters)
            : rule.parameters,
        hit_count_7d: await getRuleHitCount(rule.id),
    })));
    return rulesWithHitCount;
}
// ─────────────────────────────────────────
// GET /api/v1/rules/:id — single rule with full stats
// ─────────────────────────────────────────
async function getRuleById(id) {
    const rule = await (0, database_1.db)('rules').where({ id }).first();
    if (!rule)
        return null;
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
async function createRule(input, actorId) {
    // Validate parameters against the specific rule module's schema
    // Throws ZodError if invalid — controller handles this
    validateRuleParameters(input.type, input.parameters);
    const [rule] = await (0, database_1.db)('rules').insert({
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
    (0, scorer_1.invalidateRuleCache)();
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
async function updateRule(id, input, actorId) {
    const existing = await (0, database_1.db)('rules').where({ id }).first();
    if (!existing)
        return null;
    // Re-validate parameters — type might have changed
    validateRuleParameters(input.type, input.parameters);
    const [rule] = await (0, database_1.db)('rules')
        .where({ id })
        .update({
        name: input.name,
        description: input.description || null,
        type: input.type,
        parameters: JSON.stringify(input.parameters),
        severity: input.severity,
        score_weight: input.score_weight,
        is_active: input.is_active,
        updated_at: database_1.db.fn.now(),
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
    (0, scorer_1.invalidateRuleCache)();
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
async function toggleRule(id, is_active, actorId) {
    const existing = await (0, database_1.db)('rules').where({ id }).first();
    if (!existing)
        return null;
    const [rule] = await (0, database_1.db)('rules')
        .where({ id })
        .update({
        is_active,
        updated_at: database_1.db.fn.now(),
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
    (0, scorer_1.invalidateRuleCache)();
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
async function deleteRule(id, actorId) {
    const existing = await (0, database_1.db)('rules').where({ id }).first();
    if (!existing)
        return { deleted: false };
    // Count total alerts this rule has contributed to
    const result = await (0, database_1.db)('alert_rules')
        .where('rule_id', id)
        .count('id as count')
        .first();
    const alertCount = parseInt(result?.count || '0', 10);
    // Refuse deletion if rule has significant history
    if (alertCount >= 10) {
        return { deleted: false, alertCount };
    }
    await writeAuditLog('rule.deleted', id, actorId, {
        name: existing.name,
        type: existing.type,
        alert_count_at_deletion: alertCount,
    });
    await (0, database_1.db)('rules').where({ id }).delete();
    // Rule gone — invalidate cache so worker stops using it
    (0, scorer_1.invalidateRuleCache)();
    return { deleted: true, alertCount };
}
//# sourceMappingURL=rules.service.js.map