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

import { z } from 'zod';

export const RULE_TYPES = [
  'velocity',
  'amount_anomaly',
  'geo_mismatch',
  'time_anomaly',
  'round_amount',
] as const;

export const RULE_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

// Base schema for fields common to create and update
const ruleBaseSchema = z.object({
  name: z
    .string()
    .min(1, 'name is required')
    .max(100, 'name must be 100 characters or less'),

  description: z
    .string()
    .max(500)
    .optional(),

  type: z.enum(RULE_TYPES, {
    errorMap: () => ({
      message: `type must be one of: ${RULE_TYPES.join(', ')}`,
    }),
  }),

  // parameters is validated against the specific rule module in the service
  // Here we just check it's an object — deep validation happens later
  parameters: z
    .record(z.unknown())
    .refine(val => Object.keys(val).length > 0, 'parameters cannot be empty'),

  severity: z.enum(RULE_SEVERITIES, {
    errorMap: () => ({
      message: `severity must be one of: ${RULE_SEVERITIES.join(', ')}`,
    }),
  }),

  score_weight: z
    .number()
    .int()
    .min(5, 'score_weight must be at least 5')
    .max(40, 'score_weight must be at most 40')
    .default(20),

  is_active: z
    .boolean()
    .default(true),
});

// POST /api/v1/rules — all fields required except description and defaults
export const createRuleSchema = ruleBaseSchema;

// PUT /api/v1/rules/:id — same as create (full replacement)
export const updateRuleSchema = ruleBaseSchema;

// PATCH /api/v1/rules/:id/toggle — only flips is_active
export const toggleRuleSchema = z.object({
  is_active: z.boolean({
    required_error: 'is_active is required',
    invalid_type_error: 'is_active must be a boolean',
  }),
});

// Query params for GET /api/v1/rules
export const listRulesQuerySchema = z.object({
  type: z.enum(RULE_TYPES).optional(),
  severity: z.enum(RULE_SEVERITIES).optional(),
  is_active: z
    .string()
    .transform(v => v === 'true')
    .optional(),
});

export type CreateRuleInput = z.infer<typeof createRuleSchema>;
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;
export type ToggleRuleInput = z.infer<typeof toggleRuleSchema>;
export type ListRulesQuery = z.infer<typeof listRulesQuerySchema>;