"use strict";
// apps/api/src/modules/rules/rules.controller.ts
// HTTP layer for the rules API
// Thin: validate input → call service → format response
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRules = getRules;
exports.getRule = getRule;
exports.postRule = postRule;
exports.putRule = putRule;
exports.patchRuleToggle = patchRuleToggle;
exports.removeRule = removeRule;
const zod_1 = require("zod");
const rules_schema_1 = require("./rules.schema");
const rules_service_1 = require("./rules.service");
// ─────────────────────────────────────────
// Helper: format ZodError into consistent API response
// ─────────────────────────────────────────
function formatZodError(error, req) {
    return {
        error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request payload',
            details: error.errors.map(e => ({
                field: e.path.join('.'),
                message: e.message,
            })),
            request_id: req.requestId,
            timestamp: new Date().toISOString(),
        },
    };
}
// GET /api/v1/rules
async function getRules(req, res, next) {
    try {
        const query = rules_schema_1.listRulesQuerySchema.parse(req.query);
        const rules = await (0, rules_service_1.listRules)({
            type: query.type,
            severity: query.severity,
            is_active: query.is_active,
        });
        res.status(200).json({ data: rules, total: rules.length });
    }
    catch (error) {
        if (error instanceof zod_1.ZodError) {
            res.status(400).json(formatZodError(error, req));
            return;
        }
        next(error);
    }
}
// GET /api/v1/rules/:id
async function getRule(req, res, next) {
    try {
        const rule = await (0, rules_service_1.getRuleById)(req.params.id);
        if (!rule) {
            res.status(404).json({
                error: {
                    code: 'NOT_FOUND',
                    message: `Rule ${req.params.id} not found`,
                    request_id: req.requestId,
                },
            });
            return;
        }
        res.status(200).json({ rule });
    }
    catch (error) {
        next(error);
    }
}
// POST /api/v1/rules
async function postRule(req, res, next) {
    try {
        const input = rules_schema_1.createRuleSchema.parse(req.body);
        const rule = await (0, rules_service_1.createRule)(input, req.user.userId);
        res.status(201).json({ rule });
    }
    catch (error) {
        if (error instanceof zod_1.ZodError) {
            res.status(400).json(formatZodError(error, req));
            return;
        }
        next(error);
    }
}
// PUT /api/v1/rules/:id
async function putRule(req, res, next) {
    try {
        const input = rules_schema_1.updateRuleSchema.parse(req.body);
        const rule = await (0, rules_service_1.updateRule)(req.params.id, input, req.user.userId);
        if (!rule) {
            res.status(404).json({
                error: {
                    code: 'NOT_FOUND',
                    message: `Rule ${req.params.id} not found`,
                    request_id: req.requestId,
                },
            });
            return;
        }
        res.status(200).json({ rule });
    }
    catch (error) {
        if (error instanceof zod_1.ZodError) {
            res.status(400).json(formatZodError(error, req));
            return;
        }
        next(error);
    }
}
// PATCH /api/v1/rules/:id/toggle
async function patchRuleToggle(req, res, next) {
    try {
        const input = rules_schema_1.toggleRuleSchema.parse(req.body);
        const rule = await (0, rules_service_1.toggleRule)(req.params.id, input.is_active, req.user.userId);
        if (!rule) {
            res.status(404).json({
                error: {
                    code: 'NOT_FOUND',
                    message: `Rule ${req.params.id} not found`,
                    request_id: req.requestId,
                },
            });
            return;
        }
        res.status(200).json({ rule });
    }
    catch (error) {
        if (error instanceof zod_1.ZodError) {
            res.status(400).json(formatZodError(error, req));
            return;
        }
        next(error);
    }
}
// DELETE /api/v1/rules/:id
async function removeRule(req, res, next) {
    try {
        const result = await (0, rules_service_1.deleteRule)(req.params.id, req.user.userId);
        if (!result.deleted && result.alertCount === undefined) {
            res.status(404).json({
                error: {
                    code: 'NOT_FOUND',
                    message: `Rule ${req.params.id} not found`,
                    request_id: req.requestId,
                },
            });
            return;
        }
        if (!result.deleted && result.alertCount !== undefined) {
            res.status(409).json({
                error: {
                    code: 'CONFLICT',
                    message: `Cannot delete rule — it has ${result.alertCount} associated alerts. Deactivate it instead.`,
                    alert_count: result.alertCount,
                    request_id: req.requestId,
                },
            });
            return;
        }
        res.status(200).json({
            deleted: true,
            message: 'Rule deleted successfully',
        });
    }
    catch (error) {
        next(error);
    }
}
//# sourceMappingURL=rules.controller.js.map