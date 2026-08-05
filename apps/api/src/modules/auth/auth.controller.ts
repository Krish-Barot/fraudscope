// apps/api/src/modules/auth/auth.controller.ts
// HTTP layer for auth endpoints

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { loginSchema, registerSchema } from './auth.schema';
import {
  login,
  register,
  refresh,
  logout,
  getCurrentUser,
  verifyRefreshToken,
} from './auth.service';

// Cookie config for the refresh token
// httpOnly: JS cannot read it (XSS protection)
// secure: only sent over HTTPS (set false in dev)
// sameSite: prevents CSRF attacks
const REFRESH_COOKIE = 'fraudscope_refresh_token';

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  path: '/',
};

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

// POST /api/v1/auth/register — admin only
export async function registerHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = registerSchema.parse(req.body);
    const user = await register(
      input,
      req.user!.userId,
      req.ip || undefined
    );

    res.status(201).json({ user });
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

// POST /api/v1/auth/login
export async function loginHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = loginSchema.parse(req.body);
    const result = await login(input, req.ip || undefined);

    if (!result) {
      res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
          request_id: req.requestId,
        },
      });
      return;
    }

    // Set refresh token as httpOnly cookie
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);

    // Return access token in response body (stored in memory by frontend)
    res.status(200).json({
      user: result.user,
      access_token: result.accessToken,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json(formatZodError(error, req));
      return;
    }
    next(error);
  }
}

// POST /api/v1/auth/refresh
export async function refreshHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Read refresh token from httpOnly cookie
    const refreshToken = req.cookies[REFRESH_COOKIE];

    if (!refreshToken) {
      res.status(401).json({
        error: {
          code: 'NO_REFRESH_TOKEN',
          message: 'No refresh token provided',
          request_id: req.requestId,
        },
      });
      return;
    }

    const result = await refresh(refreshToken);

    if (!result) {
      // Clear the invalid cookie
      res.clearCookie(REFRESH_COOKIE, { path: '/' });
      res.status(401).json({
        error: {
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Refresh token is invalid or expired. Please log in again.',
          request_id: req.requestId,
        },
      });
      return;
    }

    res.status(200).json({
      user: result.user,
      access_token: result.accessToken,
    });
  } catch (error) {
    next(error);
  }
}

// POST /api/v1/auth/logout
export async function logoutHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (req.user) {
      await logout(req.user.userId, req.ip || undefined);
    }

    // Clear the refresh token cookie
    res.clearCookie(REFRESH_COOKIE, { path: '/' });

    res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/auth/me
export async function meHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await getCurrentUser(req.user!.userId);

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

    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
}