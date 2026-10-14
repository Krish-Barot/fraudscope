// apps/api/src/config/redis.ts
// Creates two Redis clients:
//   - redisClient: general purpose (GET, SET, INCR, XADD, etc.)
//   - redisPublisher: dedicated pub/sub publisher
//
// Why two clients?
// Redis has a rule: once a client enters pub/sub mode (SUBSCRIBE),
// it can ONLY send pub/sub commands. It cannot do XADD or GET anymore.
// So we need a separate client purely for publishing.

import Redis from "ioredis";
import dotenv from "dotenv";
import path from "path";

dotenv.config({
  path: path.resolve(__dirname, "../../../../.env"),
});

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  throw new Error("REDIS_URL environment variable is required");
}

// General purpose client — used for streams, caching, velocity counters
export const redisClient = new Redis(REDIS_URL, {
  // Automatically reconnect if connection drops
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000); // wait longer each retry, max 2s
    return delay;
  },

  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

// Publisher client — only used for PUBLISH commands
// Kept separate because pub/sub and regular commands cannot share a connection
export const redisPublisher = new Redis(REDIS_URL, {
  retryStrategy: (times: number) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

// Log connection events so you can see Redis status in Docker logs
redisClient.on('connect', () => console.log('✅ Redis client connected'));
redisClient.on('error', (err) => console.error('❌ Redis client error:', err.message));

redisPublisher.on('connect', () => console.log('✅ Redis publisher connected'));
redisPublisher.on('error', (err) => console.error('❌ Redis publisher error:', err.message));