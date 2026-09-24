// apps/api/src/modules/analytics/analytics.routes.ts

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import {
  getOverview,
  getAlertVolume,
  getSeverityBreakdown,
} from './analytics.controller';

const router = Router();

// Analyst and admin can view analytics
router.get('/overview',  authenticate, authorize('analyst', 'admin'), getOverview);
router.get('/alert-volume', authenticate, authorize('analyst', 'admin'), getAlertVolume);
router.get('/severity',  authenticate, authorize('analyst', 'admin'), getSeverityBreakdown);

export default router;