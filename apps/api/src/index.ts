// apps/api/src/index.ts

// ── Env validation FIRST ──────────────────────────────────────────
// Must run before any other module that reads process.env
// If validation fails, process.exit(1) is called here and nothing else runs
import { validateApiEnv } from './config/env';
const env = validateApiEnv();
// ─────────────────────────────────────────────────────────────────

import express from 'express';
import cors from 'cors';
import type { AddressInfo } from 'node:net';
import { connectDatabase } from './config/database';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import transactionRoutes from './modules/transactions/transaction.routes';
import rulesRoutes from './engine/rules/rules.routes';

const app = express();

app.use(requestIdMiddleware);
app.use(express.json());
app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
}));
app.use('/api/v1/rules', rulesRoutes);

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

function startListening(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const address = server.address() as AddressInfo | string | null;

      if (address && typeof address === 'object') {
        console.log(`✓ FraudScope API running on port ${address.port}`);
      } else {
        console.log(`✓ FraudScope API running on port ${port}`);
      }

      resolve();
    });

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error('');
        console.error(`❌ Port ${port} is already in use.`);
        console.error('   Stop the process using that port or set PORT to another value, then restart.');
        console.error('');
        process.exit(1);
      }

      reject(err);
    });
  });
}

async function start() {
  await connectDatabase();

  await startListening(env.PORT);
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

