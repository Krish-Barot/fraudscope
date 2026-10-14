// apps/api/src/modules/engine/engine.routes.ts
// Routes for serverless event-driven rule engine execution and Vercel Cron

import { Router } from 'express';
import { processTransactionHandler, cronOrBatchHandler } from './engine.controller';

const router = Router();

// Process a single transaction (event-driven / webhook / queue callback)
router.post('/process', processTransactionHandler);

// Vercel Cron target: sweeps un-evaluated transactions periodically
router.get('/cron', cronOrBatchHandler);

// Manual batch execution target
router.post('/batch', cronOrBatchHandler);

export default router;
