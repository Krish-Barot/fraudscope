"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateApiEnv = validateApiEnv;
exports.validateWorkerEnv = validateWorkerEnv;
exports.getEnv = getEnv;
const zod_1 = require("zod");
// ── Shared variables — required by BOTH api and worker ──────────
const sharedSchema = zod_1.z.object({
    DATABASE_URL: zod_1.z
        .string({ required_error: 'DATABASE_URL is required' })
        .startsWith('postgresql://', 'DATABASE_URL must start with postgresql://'),
    REDIS_URL: zod_1.z
        .string({ required_error: 'REDIS_URL is required' })
        .startsWith('redis://', 'REDIS_URL must start with redis://'),
    NODE_ENV: zod_1.z
        .enum(['development', 'test', 'production'])
        .default('development'),
    LOG_LEVEL: zod_1.z
        .enum(['debug', 'info', 'warn', 'error'])
        .default('info'),
    ENGINE_POLL_INTERVAL: zod_1.z.coerce.number().int().min(10).max(10000).default(100),
    ANALYTICS_CACHE_TTL: zod_1.z.coerce.number().int().min(0).default(300),
    SIM_ENABLED: zod_1.z.string().transform((v) => v === 'true').default('false'),
    TEST_DATABASE_URL: zod_1.z.string().optional(),
});
// ── API-only variables — only required when running the API server ──
const apiSchema = sharedSchema.extend({
    JWT_ACCESS_SECRET: zod_1.z
        .string({ required_error: 'JWT_ACCESS_SECRET is required' })
        .min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
    JWT_REFRESH_SECRET: zod_1.z
        .string({ required_error: 'JWT_REFRESH_SECRET is required' })
        .min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
    API_KEY: zod_1.z
        .string({ required_error: 'API_KEY is required' })
        .min(8, 'API_KEY must be at least 8 characters'),
    PORT: zod_1.z.coerce
        .number({ required_error: 'PORT is required' })
        .int()
        .min(1024)
        .max(65535),
    CORS_ORIGIN: zod_1.z
        .string({ required_error: 'CORS_ORIGIN is required' })
        .min(1),
    JWT_ACCESS_EXPIRY: zod_1.z.string().default('15m'),
    JWT_REFRESH_EXPIRY: zod_1.z.string().default('7d'),
});
// ── Worker-only variables — only required when running the worker ──
const workerSchema = sharedSchema.extend({
    ENGINE_BATCH_SIZE: zod_1.z.coerce.number().int().min(1).max(100).default(10),
});
let validatedEnv;
function formatErrors(error) {
    const errors = error.flatten().fieldErrors;
    console.error('');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('  Environment variable validation failed');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('');
    Object.entries(errors).forEach(([field, messages]) => {
        console.error(`  ❌ ${field}`);
        messages?.forEach((msg) => console.error(`    → ${msg}`));
        console.error('');
    });
    console.error('  Fix the above errors and restart.');
    console.error('  See .env.example for reference.');
    console.error('');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('');
}
function maskSecret(url) {
    try {
        const parsed = new URL(url);
        if (parsed.password)
            parsed.password = '***';
        return parsed.toString();
    }
    catch {
        return '***';
    }
}
// Call this in index.ts (API server)
function validateApiEnv() {
    const result = apiSchema.safeParse(process.env);
    if (!result.success) {
        formatErrors(result.error);
        process.exit(1);
    }
    validatedEnv = result.data;
    if (result.data.NODE_ENV !== 'production') {
        console.log('');
        console.log('✅ Environment validated (API)');
        console.log(`  NODE_ENV:             ${result.data.NODE_ENV}`);
        console.log(`  PORT:                 ${result.data.PORT}`);
        console.log(`  DATABASE_URL:         ${maskSecret(result.data.DATABASE_URL)}`);
        console.log(`  REDIS_URL:            ${result.data.REDIS_URL}`);
        console.log(`  LOG_LEVEL:            ${result.data.LOG_LEVEL}`);
        console.log('');
    }
    return result.data;
}
// Call this in worker.ts (rule engine worker)
function validateWorkerEnv() {
    const result = workerSchema.safeParse(process.env);
    if (!result.success) {
        formatErrors(result.error);
        process.exit(1);
    }
    validatedEnv = result.data;
    if (result.data.NODE_ENV !== 'production') {
        console.log('');
        console.log('✅ Environment validated (Worker)');
        console.log(`  NODE_ENV:             ${result.data.NODE_ENV}`);
        console.log(`  DATABASE_URL:         ${maskSecret(result.data.DATABASE_URL)}`);
        console.log(`  REDIS_URL:            ${result.data.REDIS_URL}`);
        console.log(`  ENGINE_POLL_INTERVAL: ${result.data.ENGINE_POLL_INTERVAL}ms`);
        console.log('');
    }
    return result.data;
}
function getEnv() {
    if (!validatedEnv) {
        throw new Error('getEnv() called before validateEnv(). Call validateApiEnv() or validateWorkerEnv() first.');
    }
    return validatedEnv;
}
//# sourceMappingURL=env.js.map