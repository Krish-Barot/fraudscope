"use strict";
// apps/api/src/modules/rules/rules.schema.ts
// Validation schemas for the rules API
//
// The tricky part here is parameter validation.
// Each rule type has different parameters with different shapes.
// We use a discriminated union approach: validate the type field first,
// then validate parameters against the matching rule's parameterSchema.
//
// This means:
//   POST { type: 'velocity', parameters: { max_count: 5, window_minutes: 10 } } → valid
//   POST { type: 'velocity', parameters: { min_amount: 500 } } → invalid (wrong params for type)
//   POST { type: 'velocity', parameters: { max_count: -1, window_minutes: 10 } } → invalid (max_count < 1)
Object.defineProperty(exports, "__esModule", { value: true });
exports.listRulesQuerySchema = exports.toggleRuleSchema = exports.updateRuleSchema = exports.createRuleSchema = exports.RULE_SEVERITIES = exports.RULE_TYPES = void 0;
const zod_1 = require("zod");
exports.RULE_TYPES = [
    'velocity',
    'amount_anomaly',
    'geo_mismatch',
    'time_anomaly',
    'round_amount',
];
exports.RULE_SEVERITIES = ['low', 'medium', 'high', 'critical'];
// Base schema for fields common to create and update
const ruleBaseSchema = zod_1.z.object({
    name: zod_1.z
        .string()
        .min(1, 'name is required')
        .max(100, 'name must be 100 characters or less'),
    description: zod_1.z
        .string()
        .max(500)
        .optional(),
    type: zod_1.z.enum(exports.RULE_TYPES, {
        errorMap: () => ({
            message: `type must be one of: ${exports.RULE_TYPES.join(', ')}`,
        }),
    }),
    // parameters is validated against the specific rule module in the service
    // Here we just check it's an object — deep validation happens later
    parameters: zod_1.z
        .record(zod_1.z.unknown())
        .refine(val => Object.keys(val).length > 0, 'parameters cannot be empty'),
    severity: zod_1.z.enum(exports.RULE_SEVERITIES, {
        errorMap: () => ({
            message: `severity must be one of: ${exports.RULE_SEVERITIES.join(', ')}`,
        }),
    }),
    score_weight: zod_1.z
        .number()
        .int()
        .min(5, 'score_weight must be at least 5')
        .max(40, 'score_weight must be at most 40')
        .default(20),
    is_active: zod_1.z
        .boolean()
        .default(true),
});
// POST /api/v1/rules — all fields required except description and defaults
exports.createRuleSchema = ruleBaseSchema;
// PUT /api/v1/rules/:id — same as create (full replacement)
exports.updateRuleSchema = ruleBaseSchema;
// PATCH /api/v1/rules/:id/toggle — only flips is_active
exports.toggleRuleSchema = zod_1.z.object({
    is_active: zod_1.z.boolean({
        required_error: 'is_active is required',
        invalid_type_error: 'is_active must be a boolean',
    }),
});
// Query params for GET /api/v1/rules
exports.listRulesQuerySchema = zod_1.z.object({
    type: zod_1.z.enum(exports.RULE_TYPES).optional(),
    severity: zod_1.z.enum(exports.RULE_SEVERITIES).optional(),
    is_active: zod_1.z
        .string()
        .transform(v => v === 'true')
        .optional(),
});
//# sourceMappingURL=rules.schema.js.map