// apps/api/src/modules/alerts/alerts.schema.ts

import { z } from 'zod';

// Valid actions an analyst can take
export const VALID_ACTIONS = ['dismiss', 'escalate', 'investigate', 'reassign', 'comment'] as const;
export type AlertAction = typeof VALID_ACTIONS[number];

// State machine — which actions are allowed from each status
// Maps current status → array of allowed actions
export const ALLOWED_TRANSITIONS: Record<string, AlertAction[]> = {
  new:          ['dismiss', 'escalate', 'investigate', 'comment'],
  reviewing:    ['dismiss', 'escalate', 'investigate', 'comment', 'reassign'],
  investigating: ['dismiss', 'escalate', 'comment', 'reassign'],
  // Terminal states — no further actions allowed
  dismissed:    [],
  escalated:    [],
};

// Maps action → new status
export const ACTION_STATUS_MAP: Record<AlertAction, string | null> = {
  dismiss:     'dismissed',
  escalate:    'escalated',
  investigate: 'investigating',
  reassign:    'reviewing',
  comment:     null,  // comment doesn't change status
};

// Terminal statuses — set resolved_at when reached
export const TERMINAL_STATUSES = new Set(['dismissed', 'escalated']);

export const alertActionSchema = z.object({
  action: z.enum(VALID_ACTIONS, {
    errorMap: () => ({
      message: `action must be one of: ${VALID_ACTIONS.join(', ')}`,
    }),
  }),

  reason: z
    .string({ required_error: 'reason is required' })
    .min(10, 'reason must be at least 10 characters')
    .max(1000, 'reason must be at most 1000 characters'),
});

export const listAlertsQuerySchema = z.object({
  status: z.string().optional(),
  severity: z.string().optional(),
  sort: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type AlertActionInput = z.infer<typeof alertActionSchema>;
export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>;