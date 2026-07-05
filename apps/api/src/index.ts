// apps/api/src/index.ts
// Express app entry point
// Sets up middleware, mounts routes, starts the server

import express from 'express';
import cors from 'cors';
import { connectDatabase } from './config/database';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import transactionRoutes from './modules/transactions/transaction.routes';

const app = express();
const PORT = process.env.PORT || 3002;

// ─────────────────────────────────────────
// Global middleware
// Order matters — these run on every request in sequence
// ─────────────────────────────────────────

// Attach unique request ID to every request
app.use(requestIdMiddleware);

// Parse JSON request bodies
// Without this, req.body is undefined
app.use(express.json());

// Allow requests from the Next.js dashboard
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));

// ─────────────────────────────────────────
// Routes
// ─────────────────────────────────────────

// Health check — no auth required
// Used by Docker healthcheck and monitoring systems
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'fraudscope-api',
    timestamp: new Date().toISOString(),
    request_id: req.requestId,
  });
});

// Mount transaction routes at /api/v1/transactions
app.use('/api/v1/transactions', transactionRoutes);

// ─────────────────────────────────────────
// Global error handler
// Must be registered AFTER all routes
// ─────────────────────────────────────────
app.use(errorHandler);

// ─────────────────────────────────────────
// Start server
// ─────────────────────────────────────────
async function start() {
  // Connect to database first — fail fast if DB is unavailable
  await connectDatabase();

  app.listen(PORT, () => {
    console.log(`✓ FraudScope API running on port ${PORT}`);
    console.log(`  Health check: http://localhost:${PORT}/health`);
    console.log(`  Transactions: http://localhost:${PORT}/api/v1/transactions`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});