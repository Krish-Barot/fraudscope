// apps/api/src/modules/rules/rules.controller.ts
// HTTP layer for the rules API
// Thin: validate input → call service → format response

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import {
  createRuleSchema,
  updateRuleSchema,
  toggleRuleSchema,
  listRulesQuerySchema,
} from './rules.schema';
import {
  listRules,
  getRuleById,
  createRule,
  updateRule,
  toggleRule,
  deleteRule,
} from './rules.service';

// ─────────────────────────────────────────
// Helper: format ZodError into consistent API response
// ─────────────────────────────────────────
function formatZodError(error: ZodError, req: Request): object {
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
export async function getRules(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = listRulesQuerySchema.parse(req.query);
    const rules = await listRules({
      type: query.type,
      severity: query.severity,
      is_active: query.is_active,
    });

    res.status(200).json({ data: rules, total: rules.length });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json(formatZodError(error, req));
      return;
    }
    next(error);
  }
}

// GET /api/v1/rules/:id
export async function getRule(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rule = await getRuleById(req.params.id);

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
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/rules
export async function postRule(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = createRuleSchema.parse(req.body);
    const rule = await createRule(input, req.user!.userId);

    res.status(201).json({ rule });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json(formatZodError(error, req));
      return;
    }
    next(error);
  }
}

// PUT /api/v1/rules/:id
export async function putRule(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = updateRuleSchema.parse(req.body);
    const rule = await updateRule(req.params.id, input, req.user!.userId);

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
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json(formatZodError(error, req));
      return;
    }
    next(error);
  }
}

// PATCH /api/v1/rules/:id/toggle
export async function patchRuleToggle(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = toggleRuleSchema.parse(req.body);
    const rule = await toggleRule(req.params.id, input.is_active, req.user!.userId);

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
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json(formatZodError(error, req));
      return;
    }
    next(error);
  }
}

// DELETE /api/v1/rules/:id
export async function removeRule(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await deleteRule(req.params.id, req.user!.userId);

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
  } catch (error) {
    next(error);
  }
}