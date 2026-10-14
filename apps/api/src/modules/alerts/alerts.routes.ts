// apps/api/src/modules/alerts/alerts.routes.ts
// Route order matters here:
// /counts MUST come before /:id
// Otherwise Express treats 'counts' as an alert ID

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import {
  getAlertsHandler,
  getAlertCountsHandler,
  getAlertHandler,
  takeActionHandler,
} from './alerts.controller';

const router = Router();

// GET /api/v1/alerts
router.get(
  '/',
  authenticate,
  authorize('analyst', 'admin'),
  getAlertsHandler
);

// GET /api/v1/alerts/counts
// MUST be before /:id — 'counts' would be treated as an ID otherwise
router.get(
  '/counts',
  authenticate,
  authorize('analyst', 'admin'),
  getAlertCountsHandler
);

// GET /api/v1/alerts/:id
router.get(
  '/:id',
  authenticate,
  authorize('analyst', 'admin'),
  getAlertHandler
);

// POST /api/v1/alerts/:id/actions
router.post(
  '/:id/actions',
  authenticate,
  authorize('analyst', 'admin'),
  takeActionHandler
);

export default router;