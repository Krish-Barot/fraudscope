// apps/api/src/middleware/errorHandler.ts
// Global error handler — catches any error thrown in route handlers
// Must be registered LAST (after all routes) in Express
// Must have 4 parameters (err, req, res, next) — Express identifies it by arity

import { Request, Response, NextFunction } from 'express';

// Custom error class so we can attach HTTP status codes to errors
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction // eslint-disable-line @typescript-eslint/no-unused-vars
): void {
  // Handle our custom errors (thrown intentionally)
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        request_id: req.requestId,
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  // Handle PostgreSQL unique constraint violations
  // Error code 23505 is PostgreSQL's code for unique_violation
  if ((err as any).code === '23505') {
    res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'A record with this identifier already exists',
        request_id: req.requestId,
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  // Unexpected errors — log them and return a generic message
  // Never expose internal error details to the client
  console.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    request_id: req.requestId,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      request_id: req.requestId,
      timestamp: new Date().toISOString(),
    },
  });
}