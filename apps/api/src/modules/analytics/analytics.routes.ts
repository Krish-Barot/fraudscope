import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import {
  getOverview,
  getAlertVolume,
  getSeverityBreakdown,
  getRuleEffectiveness,
  getResolution,
  getAnalystPerformance,
} from './analytics.controller';

const router = Router();

router.get('/overview', authenticate, authorize('analyst', 'admin'), getOverview);
router.get('/alert-volume', authenticate, authorize('analyst', 'admin'), getAlertVolume);
router.get('/severity', authenticate, authorize('analyst', 'admin'), getSeverityBreakdown);
router.get('/rule-effectiveness', authenticate, authorize('analyst', 'admin'), getRuleEffectiveness);
router.get('/resolution', authenticate, authorize('analyst', 'admin'), getResolution);
router.get('/analyst-performance', authenticate, authorize('analyst', 'admin'), getAnalystPerformance);

export default router;