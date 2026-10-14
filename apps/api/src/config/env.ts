import { z } from 'zod';

// ── Shared variables — required by BOTH api and worker ──────────
const sharedSchema = z.object({
  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL is required' })
    .refine(
      (url) => url.startsWith('postgresql://') || url.startsWith('postgres://'),
      'DATABASE_URL must start with postgresql:// or postgres://',
    ),

  REDIS_URL: z
    .string({ required_error: 'REDIS_URL is required' })
    .refine(
      (url) => url.startsWith('redis://') || url.startsWith('rediss://'),
      'REDIS_URL must start with redis:// or rediss://',
    ),

  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'])
    .default('info'),

  ENGINE_POLL_INTERVAL: z.coerce.number().int().min(10).max(10000).default(100),
  ANALYTICS_CACHE_TTL: z.coerce.number().int().min(0).default(300),
  SIM_ENABLED: z.string().transform((v) => v === 'true').default('false'),
  TEST_DATABASE_URL: z.string().optional(),
});

// ── API-only variables — only required when running the API server ──
const apiSchema = sharedSchema.extend({
  JWT_ACCESS_SECRET: z
    .string({ required_error: 'JWT_ACCESS_SECRET is required' })
    .min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),

  JWT_REFRESH_SECRET: z
    .string({ required_error: 'JWT_REFRESH_SECRET is required' })
    .min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),

  API_KEY: z
    .string({ required_error: 'API_KEY is required' })
    .min(8, 'API_KEY must be at least 8 characters'),

  PORT: z.coerce
    .number()
    .int()
    .min(1024)
    .max(65535)
    .default(3002),

  CORS_ORIGIN: z
    .string({ required_error: 'CORS_ORIGIN is required' })
    .min(1),

  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  ENGINE_SECRET: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

// ── Worker-only variables — only required when running the worker ──
const workerSchema = sharedSchema.extend({
  ENGINE_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
});

export type ApiEnv = z.infer<typeof apiSchema>;
export type WorkerEnv = z.infer<typeof workerSchema>;
export type Env = ApiEnv | WorkerEnv;

let validatedEnv: Env;

function formatErrors(error: z.ZodError): void {
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

function maskSecret(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '***';
  }
}

// Call this in index.ts (API server)
export function validateApiEnv(): ApiEnv {
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
export function validateWorkerEnv(): WorkerEnv {
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

export function getEnv(): Env {
  if (!validatedEnv) {
    throw new Error('getEnv() called before validateEnv(). Call validateApiEnv() or validateWorkerEnv() first.');
  }
  return validatedEnv;
}