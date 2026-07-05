// apps/api/src/modules/transactions/transaction.routes.ts
// Wires URL paths to controller functions
// Also applies route-specific middleware (apiKeyAuth on POST)

import { Router } from 'express';
import { apiKeyAuth } from '../../middleware/apiKeyAuth';
import {
  createTransaction,
  getTransactions,
  getTransaction,
} from './transaction.controller';

const router = Router();

// POST /api/v1/transactions
// Protected by API key — only trusted systems can ingest transactions
router.post('/', apiKeyAuth, createTransaction);

// GET /api/v1/transactions
// Will be protected by JWT in FS-20 (auth sprint)
// For now, open so we can test during development
router.get('/', getTransactions);

// GET /api/v1/transactions/:id
router.get('/:id', getTransaction);

export default router;