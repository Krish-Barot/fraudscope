// apps/api/src/modules/alerts/alerts.controller.ts

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { alertActionSchema } from './alerts.schema';
import {
  listAlerts,
  getAlertById,
  takeAlertAction,
  getAlertCounts,
} from './alerts.service';

// GET /api/v1/alerts
export async function getAlerts(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const filters = {
      status: req.query.status as string | undefined,
      severity: req.query.severity as string | undefined,
      sort: req.query.sort as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    };

    const result = await listAlerts(filters);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/alerts/counts
export async function getCounts(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const counts = await getAlertCounts();
    res.status(200).json(counts);
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/alerts/:id
export async function getAlert(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await getAlertById(req.params.id);

    if (!result) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Alert ${req.params.id} not found`,
          request_id: req.requestId,
        },
      });
      return;
    }

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/alerts/:id/actions
export async function postAlertAction(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = alertActionSchema.parse(req.body);
    const analystId = req.user?.userId;

    if (!analystId) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          request_id: req.requestId,
        },
      });
      return;
    }

    const result = await takeAlertAction(
      req.params.id,
      analystId,
      input.action,
      input.reason
    );

    if (!result) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Alert ${req.params.id} not found`,
          request_id: req.requestId,
        },
      });
      return;
    }

    res.status(200).json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid action payload',
          details: error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
          request_id: req.requestId,
        },
      });
      return;
    }

    next(error);
  }
}
