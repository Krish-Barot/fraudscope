// apps/api/src/modules/auth/auth.routes.ts

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  updateProfileHandler,
} from './auth.controller';

const router = Router();

// POST /api/v1/auth/register — admin only
router.post(
  '/register',
  authenticate,
  authorize('admin'),
  registerHandler
);

// POST /api/v1/auth/login — public
router.post('/login', loginHandler);

// POST /api/v1/auth/refresh — public (uses httpOnly cookie)
router.post('/refresh', refreshHandler);

// POST /api/v1/auth/logout — protected (to write audit log)
router.post('/logout', authenticate, logoutHandler);

// GET /api/v1/auth/me — protected
router.get('/me', authenticate, meHandler);

// PATCH /api/v1/auth/me — protected (update profile/password)
router.patch('/me', authenticate, updateProfileHandler);

export default router;