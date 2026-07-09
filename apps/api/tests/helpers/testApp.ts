// apps/api/tests/helpers/testApp.ts
// Creates a fresh Express app instance for testing
//
// Why not import the main app from index.ts?
// index.ts calls app.listen() which starts a real server on a port.
// For testing, supertest manages the server internally — we just need
// the Express app object, not a running server.
// Supertest calls app.listen(0) internally which picks a random free port.

import express from 'express';
import cors from 'cors';
import { requestIdMiddleware } from '../../src/middleware/requestId';
import { errorHandler } from '../../src/middleware/errorHandler';
import transactionRoutes from '../../src/modules/transactions/transaction.routes';

export function createTestApp() {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(express.json());
  app.use(cors());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/v1/transactions', transactionRoutes);
  app.use(errorHandler);

  return app;
}