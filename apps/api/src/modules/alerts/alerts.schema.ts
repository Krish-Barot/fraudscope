// apps/api/src/modules/alerts/alerts.schema.ts

import { z } from 'zod';

export const alertActionSchema = z.object({
  action: z.enum(['dismiss', 'escalate', 'investigate']),
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
});

export type AlertActionInput = z.infer<typeof alertActionSchema>;
