// apps/api/src/modules/users/users.controller.ts
// HTTP controllers for users endpoints (FS-28)

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { createUserSchema, updateUserSchema } from './users.schema';
import {
  getUsers,
  getUserById,
  updateUser,
  createUser,
} from './users.service';

function formatZodError(error: ZodError, req: Request) {
  return {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request payload',
      details: error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
      request_id: req.requestId,
    },
  };
}

// GET /api/v1/users
export async function getUsersHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const users = await getUsers();
    res.status(200).json({ users });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/users/:id
export async function getUserHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await getUserById(req.params.id);
    if (!user) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'User not found',
          request_id: req.requestId,
        },
      });
      return;
    }

    res.status(200).json({ user, stats: user.stats });
  } catch (error) {
    next(error);
  }
}

// PATCH /api/v1/users/:id
export async function updateUserHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = updateUserSchema.parse(req.body);
    const user = await updateUser(
      req.params.id,
      input,
      req.user?.userId,
      req.ip || undefined
    );

    res.status(200).json({ user });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json(formatZodError(error, req));
      return;
    }
    if ((error as any).code === 'NOT_FOUND') {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'User not found',
          request_id: req.requestId,
        },
      });
      return;
    }
    next(error);
  }
}

// POST /api/v1/users
export async function createUserHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = createUserSchema.parse(req.body);
    const result = await createUser(
      input,
      req.user?.userId,
      req.ip || undefined
    );

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json(formatZodError(error, req));
      return;
    }
    if ((error as any).code === 'DUPLICATE_EMAIL') {
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'An account with this email already exists',
          request_id: req.requestId,
        },
      });
      return;
    }
    next(error);
  }
}
