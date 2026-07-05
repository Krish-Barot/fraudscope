// apps/api/src/modules/transactions/transaction.routes.ts

import { Router } from 'express';
import { apiKeyAuth } from '../../middleware/apiKeyAuth';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import {
  createTransaction,
  getTransactions,
  getTransaction,
} from './transaction.controller';

const router = Router();

// POST /api/v1/transactions
// Machine-to-machine — protected by API key
router.post('/', apiKeyAuth, createTransaction);

// GET /api/v1/transactions
// Human analyst — protected by JWT
// authorize('analyst', 'admin') means both roles can access
router.get('/', authenticate, authorize('analyst', 'admin'), getTransactions);

// GET /api/v1/transactions/:id
router.get('/:id', authenticate, authorize('analyst', 'admin'), getTransaction);

export default router;