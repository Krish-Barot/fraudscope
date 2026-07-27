// apps/api/tests/helpers/testApp.ts

import express from 'express';
import cors from 'cors';
import { requestIdMiddleware } from '../../src/middleware/requestId';
import { errorHandler } from '../../src/middleware/errorHandler';
import transactionRoutes from '../../src/modules/transactions/transaction.routes';
import rulesRoutes from '../../src/engine/rules/rules.routes';

export function createTestApp() {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(express.json());
  app.use(cors());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/v1/transactions', transactionRoutes);
  app.use('/api/v1/rules', rulesRoutes);   

  app.use(errorHandler);

  return app;
}