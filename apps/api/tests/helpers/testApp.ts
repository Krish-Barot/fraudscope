// apps/api/tests/helpers/testApp.ts

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { requestIdMiddleware } from '../../src/middleware/requestId';
import { errorHandler } from '../../src/middleware/errorHandler';
import authRoutes from '../../src/modules/auth/auth.routes';
import transactionRoutes from '../../src/modules/transactions/transaction.routes';
import rulesRoutes from '../../src/modules/rules/rules.routes';
import alertsRoutes from '../../src/modules/alerts/alerts.routes';

export function createTestApp() {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(express.json());
  app.use(cors());
  app.use(cookieParser());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/transactions', transactionRoutes);
  app.use('/api/v1/rules', rulesRoutes);
  app.use('/api/v1/alerts', alertsRoutes);
  app.use(errorHandler);

  return app;
}