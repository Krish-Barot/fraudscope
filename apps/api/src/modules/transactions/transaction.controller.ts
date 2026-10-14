// apps/api/src/modules/transactions/transaction.controller.ts

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { createTransactionSchema } from './transaction.schema';
import {
  ingestTransaction,
  getTransactionById,
  listTransactions,
  searchGlobalService,
} from './transaction.service';

// POST /api/v1/transactions — FS-04 (unchanged)
export async function createTransaction(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = createTransactionSchema.parse(req.body);
    const transaction = await ingestTransaction(input);

    res.status(202).json({
      transaction,
      queued: true,
      message: 'Transaction accepted and queued for fraud evaluation',
    });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid transaction payload',
          details: error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
          request_id: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    if ((error as any).code === '23505') {
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: `Transaction with external_id '${req.body.external_id}' already exists`,
          request_id: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    next(error);
  }
}

// GET /api/v1/transactions — FS-05
export async function getTransactions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Parse and sanitize query parameters
    // req.query values are always strings — convert numbers explicitly
    const filters = {
      status: req.query.status as string | undefined,
      min_amount: req.query.min_amount
        ? Number(req.query.min_amount)
        : undefined,
      max_amount: req.query.max_amount
        ? Number(req.query.max_amount)
        : undefined,
      country_code: req.query.country_code as string | undefined,
      account_id: req.query.account_id as string | undefined,
      channel: req.query.channel as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 25,
      sort: req.query.sort as string | undefined,
    };

    const result = await listTransactions(filters);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/transactions/:id — FS-05
export async function getTransaction(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await getTransactionById(req.params.id);

    if (!result) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Transaction ${req.params.id} not found`,
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

// GET /api/v1/transactions/search?q=...
export async function searchGlobalHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const q = (req.query.q as string) || '';
    const result = await searchGlobalService(q);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}