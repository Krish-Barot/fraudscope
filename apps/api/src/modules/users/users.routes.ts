// apps/api/src/modules/users/users.routes.ts
// Express routes for users management (FS-28)
// All routes here are restricted to administrators

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import {
  getUsersHandler,
  getUserHandler,
  updateUserHandler,
  createUserHandler,
} from './users.controller';

const router = Router();

// Apply auth and admin check to all routes in this router
router.use(authenticate, authorize('admin'));

// GET /api/v1/users — list all users with stats
router.get('/', getUsersHandler);

// POST /api/v1/users — create user
router.post('/', createUserHandler);

// GET /api/v1/users/:id — get user by ID
router.get('/:id', getUserHandler);

// PATCH /api/v1/users/:id — update user role/status
router.patch('/:id', updateUserHandler);

export default router;
