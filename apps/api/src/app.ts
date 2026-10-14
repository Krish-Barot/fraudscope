// apps/api/src/app.ts
// Express application setup and route registration

import express, { Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { validateApiEnv } from './config/env';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';

import authRoutes from './modules/auth/auth.routes';
import transactionRoutes from './modules/transactions/transaction.routes';
import rulesRoutes from './modules/rules/rules.routes';
import alertsRoutes from './modules/alerts/alerts.routes';
import usersRoutes from './modules/users/users.routes';
import auditRoutes from './modules/audit/audit.routes';
import healthRoutes from './modules/health/health.routes';
import analyticsRoutes from './modules/analytics/analytics.routes';
import engineRoutes from './modules/engine/engine.routes';

const env = validateApiEnv();

export function createApp(): Express {
  const app = express();

  // ── Global middleware ─────────────────────────────────────────────
  app.use(requestIdMiddleware);
  app.use(express.json());
  app.use(cookieParser());
  app.use(cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }));

  // ── Health check ──────────────────────────────────────────────────
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'fraudscope-api',
      timestamp: new Date().toISOString(),
      request_id: req.requestId,
    });
  });

  // ── Routes ────────────────────────────────────────────────────────
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/transactions', transactionRoutes);
  app.use('/api/v1/rules', rulesRoutes);
  app.use('/api/v1/alerts', alertsRoutes);
  app.use('/api/v1/users', usersRoutes);
  app.use('/api/v1/audit-logs', auditRoutes);
  app.use('/api/v1/health', healthRoutes);
  app.use('/api/v1/analytics', analyticsRoutes);
  app.use('/api/v1/engine', engineRoutes);

  // ── Error handling ────────────────────────────────────────────────
  app.use(errorHandler);

  return app;
}

export const app = createApp();
export default app;
