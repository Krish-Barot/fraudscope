// apps/api/src/modules/transactions/transaction.controller.ts
// HTTP layer — reads request, calls service, sends response
// Controllers are thin: validate → call service → respond
// All business logic lives in the service

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { createTransactionSchema } from './transaction.schema';
import { ingestTransaction, getTransactionById, listTransactions } from './transaction.service';

// POST /api/v1/transactions
export async function createTransaction(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Parse and validate the request body against the Zod schema
    // .parse() throws a ZodError if validation fails
    const input = createTransactionSchema.parse(req.body);

    const transaction = await ingestTransaction(input);

    // 202 Accepted — transaction saved and queued for fraud evaluation
    // The evaluation happens asynchronously in the worker
    res.status(202).json({
      transaction,
      queued: true,
      message: 'Transaction accepted and queued for fraud evaluation',
    });
  } catch (error) {
    // Handle Zod validation errors specifically
    // ZodError has a .errors array with field-level details
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

    // Handle PostgreSQL unique constraint violation
    // This happens when external_id already exists
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

    // Pass anything else to the global error handler
    next(error);
  }
}

// GET /api/v1/transactions
export async function getTransactions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await listTransactions({
      status: req.query.status as string,
      min_amount: req.query.min_amount ? Number(req.query.min_amount) : undefined,
      max_amount: req.query.max_amount ? Number(req.query.max_amount) : undefined,
      country_code: req.query.country_code as string,
      account_id: req.query.account_id as string,
      channel: req.query.channel as string,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 25,
      sort: req.query.sort as string,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/transactions/:id
export async function getTransaction(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const transaction = await getTransactionById(req.params.id);

    if (!transaction) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Transaction ${req.params.id} not found`,
          request_id: req.requestId,
        },
      });
      return;
    }

    res.status(200).json({ transaction });
  } catch (error) {
    next(error);
  }
}