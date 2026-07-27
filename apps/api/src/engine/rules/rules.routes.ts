// apps/api/src/modules/rules/rules.routes.ts

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import {
  getRules,
  getRule,
  postRule,
  putRule,
  patchRuleToggle,
  removeRule,
} from './rules.controller';

const router = Router();

// GET /api/v1/rules — analysts and admins can list rules
router.get(
  '/',
  authenticate,
  authorize('analyst', 'admin'),
  getRules
);

// GET /api/v1/rules/:id — analysts and admins can view rule detail + stats
router.get(
  '/:id',
  authenticate,
  authorize('analyst', 'admin'),
  getRule
);

// POST /api/v1/rules — admin only
router.post(
  '/',
  authenticate,
  authorize('admin'),
  postRule
);

// PUT /api/v1/rules/:id — admin only
router.put(
  '/:id',
  authenticate,
  authorize('admin'),
  putRule
);

// PATCH /api/v1/rules/:id/toggle — admin only
// Note: this route must come BEFORE /:id to avoid Express matching 'toggle' as an ID
router.patch(
  '/:id/toggle',
  authenticate,
  authorize('admin'),
  patchRuleToggle
);

// DELETE /api/v1/rules/:id — admin only
router.delete(
  '/:id',
  authenticate,
  authorize('admin'),
  removeRule
);

export default router;