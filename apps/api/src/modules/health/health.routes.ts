// apps/api/src/modules/health/health.routes.ts

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getDetailedHealth } from './health.controller';

const router = Router();

// Admin-only — exposes service internals
router.get('/detailed', authenticate, authorize('admin'), getDetailedHealth);

export default router;