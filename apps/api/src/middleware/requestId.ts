// apps/api/src/middleware/requestId.ts
// Attaches a unique ID to every incoming request
// This lets you search logs for all events related to one request
// e.g. "show me everything that happened during request abc-123"

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Extend Express Request type to include requestId
// This tells TypeScript that req.requestId is valid
declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Check if the caller sent their own request ID (useful for tracing across services)
  // Otherwise generate a new one
  req.requestId = (req.headers['x-request-id'] as string) || uuidv4();

  // Send it back in the response so the caller can correlate their request
  res.setHeader('x-request-id', req.requestId);

  next(); // pass control to the next middleware
}