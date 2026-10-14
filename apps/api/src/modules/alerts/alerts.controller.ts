// apps/api/src/modules/alerts/alerts.controller.ts

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import {
  alertActionSchema,
  listAlertsQuerySchema,
} from './alerts.schema';
import {
  listAlerts,
  getAlertById,
  getAlertCounts,
  takeAction,
} from './alerts.service';

function formatZodError(error: ZodError, req: Request) {
  return {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request payload',
      details: error.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      })),
      request_id: req.requestId,
    },
  };
}

// GET /api/v1/alerts
export async function getAlertsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = listAlertsQuerySchema.parse(req.query);
    const result = await listAlerts({
      status:   req.query.status as string,
      severity: req.query.severity as string,
      sort:     req.query.sort as string,
      page:     query.page,
      limit:    query.limit,
    });

    res.status(200).json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json(formatZodError(error, req));
      return;
    }
    next(error);
  }
}

// GET /api/v1/alerts/counts
// IMPORTANT: this route must be registered BEFORE /:id
// otherwise Express matches 'counts' as an ID
export async function getAlertCountsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const counts = await getAlertCounts();
    res.status(200).json({ counts });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/alerts/:id
export async function getAlertHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const alert = await getAlertById(req.params.id);

    if (!alert) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Alert ${req.params.id} not found`,
          request_id: req.requestId,
        },
      });
      return;
    }

    res.status(200).json({ alert });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/alerts/:id/actions
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function takeActionHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = alertActionSchema.parse(req.body);

    // Validate that the authenticated user has a real UUID
    // (prevents "invalid input syntax for type uuid" if the JWT
    // was manually crafted with a non-UUID userId like "test-id")
    const analystId = req.user!.userId;
    if (!UUID_RE.test(analystId)) {
      res.status(401).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token contains an invalid user ID. Please log in again via /api/v1/auth/login.',
          request_id: req.requestId,
        },
      });
      return;
    }

    const result = await takeAction(
      req.params.id,
      input,
      analystId,
      req.user!.email,
      req.ip || undefined,
    );

    res.status(200).json({ alert: result });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json(formatZodError(error, req));
      return;
    }

    if ((error as any).code === 'INVALID_TRANSITION') {
      res.status(422).json({
        error: {
          code: 'INVALID_TRANSITION',
          message: (error as Error).message,
          request_id: req.requestId,
        },
      });
      return;
    }

    // 404 from service
    if ((error as any).statusCode === 404) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Alert ${req.params.id} not found`,
          request_id: req.requestId,
        },
      });
      return;
    }

    next(error);
  }
}