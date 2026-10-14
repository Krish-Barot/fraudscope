// apps/api/src/middleware/authorize.ts
// Role-based access control — runs AFTER authenticate
// Checks that the authenticated user has the required role
//
// Usage:
//   router.get('/rules', authenticate, authorize('analyst', 'admin'), handler)
//   router.post('/rules', authenticate, authorize('admin'), handler)
//
// authorize('analyst', 'admin') means EITHER role is allowed
// authorize('admin') means ONLY admins

import { Request, Response, NextFunction } from 'express';

export function authorize(...allowedRoles: ('analyst' | 'admin')[]) {
  // Returns a middleware function
  // The roles are captured in the closure
  return (req: Request, res: Response, next: NextFunction): void => {
    // authenticate must run before authorize
    // If it didn't, req.user won't exist
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          request_id: req.requestId,
        },
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `This action requires one of these roles: ${allowedRoles.join(', ')}`,
          request_id: req.requestId,
        },
      });
      return;
    }

    next();
  };
}