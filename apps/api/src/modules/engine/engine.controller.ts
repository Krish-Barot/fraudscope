// apps/api/src/modules/engine/engine.controller.ts
// Handlers for event-driven and scheduled rule engine execution

import { Request, Response, NextFunction } from 'express';
import { processSingleTransaction, processBatchPending } from './engine.service';

/**
 * Process a single transaction on demand (event-driven worker endpoint).
 * Can be invoked by external queues, webhooks, or test triggers.
 */
export async function processTransactionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { transaction_id, transaction } = req.body || {};

    if (!transaction_id && !transaction) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Either transaction_id or transaction payload is required',
          request_id: req.requestId,
        },
      });
      return;
    }

    const payload = transaction_id || transaction;
    const outcome = await processSingleTransaction(payload);

    res.status(200).json({
      success: true,
      transaction_id: outcome.transaction_id,
      status: outcome.status,
      result: {
        score: outcome.result.score,
        severity: outcome.result.severity,
        alert_id: outcome.result.alertId,
        rules_triggered: outcome.result.triggeredRules.map((r) => r.ruleType),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Sweep and process un-evaluated transactions.
 * Triggered by Vercel Cron (GET /api/v1/engine/cron) or manual batch (POST /api/v1/engine/batch).
 */
export async function cronOrBatchHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // If CRON_SECRET is configured, verify Authorization header: Bearer <CRON_SECRET>
    const expectedSecret = process.env.CRON_SECRET || process.env.ENGINE_SECRET;
    if (expectedSecret) {
      const authHeader = req.headers.authorization;
      const xSecret = req.headers['x-engine-secret'];
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (token !== expectedSecret && xSecret !== expectedSecret) {
        res.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or missing cron/engine secret',
            request_id: req.requestId,
          },
        });
        return;
      }
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 25;
    const batchSummary = await processBatchPending(limit);

    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: batchSummary,
    });
  } catch (error) {
    next(error);
  }
}
