// apps/api/src/index.ts
// Standalone / local development server entrypoint (HTTP + Socket.io)

import http from 'http';
import { app } from './app';
import { validateApiEnv } from './config/env';
import { connectDatabase } from './config/database';
import { setupWebSocket } from './websocket/index';

async function start() {
  const env = validateApiEnv();
  await connectDatabase();

  // Create HTTP server explicitly (required for Socket.io)
  const httpServer = http.createServer(app);

  // Attach Socket.io to the HTTP server
  setupWebSocket(httpServer);

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