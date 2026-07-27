"use strict";
// apps/api/src/config/redis.ts
// Creates two Redis clients:
//   - redisClient: general purpose (GET, SET, INCR, XADD, etc.)
//   - redisPublisher: dedicated pub/sub publisher
//
// Why two clients?
// Redis has a rule: once a client enters pub/sub mode (SUBSCRIBE),
// it can ONLY send pub/sub commands. It cannot do XADD or GET anymore.
// So we need a separate client purely for publishing.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisPublisher = exports.redisClient = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({
    path: path_1.default.resolve(__dirname, "../../../../.env"),
});
const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
    throw new Error("REDIS_URL environment variable is required");
}
// General purpose client — used for streams, caching, velocity counters
exports.redisClient = new ioredis_1.default(REDIS_URL, {
    // Automatically reconnect if connection drops
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000); // wait longer each retry, max 2s
        return delay;
    },
    maxRetriesPerRequest: 3,
    lazyConnect: false,
});
// Publisher client — only used for PUBLISH commands
// Kept separate because pub/sub and regular commands cannot share a connection
exports.redisPublisher = new ioredis_1.default(REDIS_URL, {
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
    lazyConnect: false,
});
// Log connection events so you can see Redis status in Docker logs
exports.redisClient.on('connect', () => console.log('✅ Redis client connected'));
exports.redisClient.on('error', (err) => console.error('❌ Redis client error:', err.message));
exports.redisPublisher.on('connect', () => console.log('✅ Redis publisher connected'));
exports.redisPublisher.on('error', (err) => console.error('❌ Redis publisher error:', err.message));
//# sourceMappingURL=redis.js.map