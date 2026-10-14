// apps/api/src/modules/analytics/analytics.routes.ts

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import {
  getOverview,
  getAlertVolume,
  getSeverityBreakdown,
  getRuleEffectiveness,
  getResolution,
  getTopAccounts,
  getAnalystPerformance,
  bustCache,
} from './analytics.controller';

const router = Router();

const analyst = [authenticate, authorize('analyst', 'admin')];
const admin = [authenticate, authorize('admin')];

router.get('/overview', ...analyst, getOverview);
router.get('/alert-volume', ...analyst, getAlertVolume);
router.get('/severity', ...analyst, getSeverityBreakdown);
router.get('/rule-effectiveness', ...analyst, getRuleEffectiveness);
router.get('/resolution', ...analyst, getResolution);
router.get('/top-accounts', ...analyst, getTopAccounts);
router.get('/analyst-performance', ...analyst, getAnalystPerformance);
router.post('/cache/bust', ...admin, bustCache);

export default router;