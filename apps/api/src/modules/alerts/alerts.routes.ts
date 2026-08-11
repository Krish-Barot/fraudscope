// apps/api/src/modules/alerts/alerts.routes.ts

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import {
  getAlerts,
  getCounts,
  getAlert,
  postAlertAction,
} from './alerts.controller';

const router = Router();

// GET /api/v1/alerts — list alerts with filters and pagination
router.get('/', authenticate, authorize('analyst', 'admin'), getAlerts);

// GET /api/v1/alerts/counts — get counts breakdown
// (must be before /:id)
router.get('/counts', authenticate, authorize('analyst', 'admin'), getCounts);

// GET /api/v1/alerts/:id — get alert details
router.get('/:id', authenticate, authorize('analyst', 'admin'), getAlert);

// POST /api/v1/alerts/:id/actions — take action (dismiss, escalate, investigate)
router.post('/:id/actions', authenticate, authorize('analyst', 'admin'), postAlertAction);

export default router;
