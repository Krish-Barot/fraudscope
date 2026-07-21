// apps/api/src/index.ts

// ── Env validation FIRST ──────────────────────────────────────────
// Must run before any other module that reads process.env
// If validation fails, process.exit(1) is called here and nothing else runs
import { validateApiEnv } from './config/env';
const env = validateApiEnv();
// ─────────────────────────────────────────────────────────────────

import express from 'express';
import cors from 'cors';
import { connectDatabase } from './config/database';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import transactionRoutes from './modules/transactions/transaction.routes';

const app = express();

app.use(requestIdMiddleware);
app.use(express.json());
app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
}));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'fraudscope-api',
    timestamp: new Date().toISOString(),
    request_id: req.requestId,
  });
});

app.use('/api/v1/transactions', transactionRoutes);
app.use(errorHandler);

async function start() {
  await connectDatabase();

  app.listen(env.PORT, () => {
    console.log(`✓ FraudScope API running on port ${env.PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});