import { validateApiEnv } from './config/env';
const env = validateApiEnv();

import express from 'express';
import http from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { connectDatabase } from './config/database';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './modules/auth/auth.routes';
import transactionRoutes from './modules/transactions/transaction.routes';
import rulesRoutes from './modules/rules/rules.routes';
import alertsRoutes from './modules/alerts/alerts.routes';
import usersRoutes from './modules/users/users.routes';
import { setupWebSocket } from './websocket/index';  
import auditRoutes from './modules/audit/audit.routes';
import healthRoutes from './modules/health/health.routes';


const app = express();

// ── Global middleware ─────────────────────────────────────────────
app.use(requestIdMiddleware);
app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
}));

// ── Routes ────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'fraudscope-api',
    timestamp: new Date().toISOString(),
    request_id: req.requestId,
  });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/transactions', transactionRoutes);
app.use('/api/v1/rules', rulesRoutes);
app.use('/api/v1/alerts', alertsRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/audit-logs', auditRoutes);
app.use('/api/v1/health', healthRoutes);

app.use(errorHandler);

// ── Startup ───────────────────────────────────────────────────────
async function start() {
  await connectDatabase();

  // Create HTTP server explicitly (required for Socket.io)
  // Previously app.listen() created this internally
  const httpServer = http.createServer(app);

  // Attach Socket.io to the HTTP server
  const io = setupWebSocket(httpServer);

  // Start listening
  httpServer.listen(env.PORT, () => {
    console.log(`✅ FraudScope API running on port ${env.PORT}`);
    console.log(`  HTTP:      http://localhost:${env.PORT}`);
    console.log(`  WebSocket: ws://localhost:${env.PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
}); 