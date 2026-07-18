// apps/api/src/config/env.ts
// Validates all environment variables at startup using Zod
//
// How to use this:
// Import and call validateEnv() as the FIRST thing in index.ts
// before any other imports that use process.env
//
// Why Zod for env validation?
// - Same library you're already using for request validation
// - Gives you TypeScript types for free
// - Error messages are clear and specific
// - Can coerce types (string "100" → number 100)
// - Can set defaults for optional vars

import { z } from 'zod';

// ─────────────────────────────────────────
// Define the schema for all environment variables
// ─────────────────────────────────────────

const envSchema = z.object({

  // ── Required variables ──────────────────
  // These MUST be set or the app refuses to start

  DATABASE_URL: z
    .string({
      required_error: 'DATABASE_URL is required (e.g. postgresql://user:pass@host:5432/db)',
    })
    .min(1, 'DATABASE_URL cannot be empty')
    .startsWith('postgresql://', 'DATABASE_URL must start with postgresql://'),

  REDIS_URL: z
    .string({
      required_error: 'REDIS_URL is required (e.g. redis://localhost:6379)',
    })
    .min(1, 'REDIS_URL cannot be empty')
    .startsWith('redis://', 'REDIS_URL must start with redis://'),

  JWT_ACCESS_SECRET: z
    .string({
      required_error: 'JWT_ACCESS_SECRET is required — used to sign access tokens',
    })
    .min(16, 'JWT_ACCESS_SECRET must be at least 16 characters for security'),

  JWT_REFRESH_SECRET: z
    .string({
      required_error: 'JWT_REFRESH_SECRET is required — used to sign refresh tokens',
    })
    .min(16, 'JWT_REFRESH_SECRET must be at least 16 characters for security'),

  API_KEY: z
    .string({
      required_error: 'API_KEY is required — used to authenticate transaction ingestion',
    })
    .min(8, 'API_KEY must be at least 8 characters'),

  PORT: z
    // env vars are always strings — coerce converts "3002" → 3002
    .coerce
    .number({
      required_error: 'PORT is required',
      invalid_type_error: 'PORT must be a number',
    })
    .int('PORT must be an integer')
    .min(1024, 'PORT must be >= 1024 (ports below 1024 require root)')
    .max(65535, 'PORT must be <= 65535'),

  CORS_ORIGIN: z
    .string({
      required_error: 'CORS_ORIGIN is required (e.g. http://localhost:3000)',
    })
    .min(1, 'CORS_ORIGIN cannot be empty'),

  // ── Optional variables with defaults ────
  // These have sensible defaults if not set

  NODE_ENV: z
    .enum(['development', 'test', 'production'], {
      errorMap: () => ({
        message: 'NODE_ENV must be one of: development, test, production',
      }),
    })
    .default('development'),

  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'], {
      errorMap: () => ({
        message: 'LOG_LEVEL must be one of: debug, info, warn, error',
      }),
    })
    .default('info'),

  // SIM_ENABLED is a string "true"/"false" in env — coerce to boolean
  SIM_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),

  ENGINE_POLL_INTERVAL: z
    .coerce
    .number()
    .int()
    .min(10, 'ENGINE_POLL_INTERVAL must be at least 10ms')
    .max(10000, 'ENGINE_POLL_INTERVAL must be at most 10000ms')
    .default(100),

  ANALYTICS_CACHE_TTL: z
    .coerce
    .number()
    .int()
    .min(0, 'ANALYTICS_CACHE_TTL cannot be negative')
    .default(300),

  // ── Optional — no default needed ────────

  JWT_ACCESS_EXPIRY: z
    .string()
    .default('15m'),

  JWT_REFRESH_EXPIRY: z
    .string()
    .default('7d'),

  TEST_DATABASE_URL: z
    .string()
    .optional(),
});

// ─────────────────────────────────────────
// TypeScript type inferred from the schema
// Import this type anywhere you need typed env access
// e.g. import { type Env } from './config/env'
// ─────────────────────────────────────────
export type Env = z.infer<typeof envSchema>;

// ─────────────────────────────────────────
// The validated env object
// Populated by validateEnv() — don't use before calling it
// ─────────────────────────────────────────
let validatedEnv: Env;

// ─────────────────────────────────────────
// Main validation function
// Call this ONCE at app startup before anything else
// ─────────────────────────────────────────
export function validateEnv(): Env {
  // .safeParse() returns { success, data } or { success: false, error }
  // unlike .parse() which throws — we want to collect ALL errors before printing
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // Format and print all errors clearly
    // ZodError.flatten() organises errors by field name
    const errors = result.error.flatten().fieldErrors;

    console.error('');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('  Environment variable validation failed');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('');

    // Print each failed variable with its specific error message
    Object.entries(errors).forEach(([field, messages]) => {
      console.error(`  ✗ ${field}`);
      messages?.forEach((msg) => {
        console.error(`    → ${msg}`);
      });
      console.error('');
    });

    console.error('  Fix the above errors and restart the server.');
    console.error('  See .env.example for reference.');
    console.error('');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('');

    // Exit immediately — app cannot run safely without valid config
    // Exit code 1 signals failure to Docker and CI/CD systems
    process.exit(1);
  }

  validatedEnv = result.data;

  // Print a summary of what was loaded (helpful for debugging deployments)
  // Only in non-production to avoid leaking config values in prod logs
  if (validatedEnv.NODE_ENV !== 'production') {
    console.log('');
    console.log('✓ Environment validated');
    console.log(`  NODE_ENV:              ${validatedEnv.NODE_ENV}`);
    console.log(`  PORT:                  ${validatedEnv.PORT}`);
    console.log(`  DATABASE_URL:          ${maskSecret(validatedEnv.DATABASE_URL)}`);
    console.log(`  REDIS_URL:             ${validatedEnv.REDIS_URL}`);
    console.log(`  LOG_LEVEL:             ${validatedEnv.LOG_LEVEL}`);
    console.log(`  SIM_ENABLED:           ${validatedEnv.SIM_ENABLED}`);
    console.log(`  ENGINE_POLL_INTERVAL:  ${validatedEnv.ENGINE_POLL_INTERVAL}ms`);
    console.log(`  ANALYTICS_CACHE_TTL:   ${validatedEnv.ANALYTICS_CACHE_TTL}s`);
    console.log('');
  }

  return validatedEnv;
}

// ─────────────────────────────────────────
// Accessor for the validated env
// Use this instead of process.env throughout the app
// It's type-safe — TypeScript knows exactly what fields exist
// ─────────────────────────────────────────
export function getEnv(): Env {
  if (!validatedEnv) {
    throw new Error(
      'getEnv() called before validateEnv(). ' +
      'Call validateEnv() at the top of index.ts first.'
    );
  }
  return validatedEnv;
}

// ─────────────────────────────────────────
// Helper — masks secrets in logs
// Shows protocol and host but hides password
// postgresql://user:PASSWORD@host:5432/db → postgresql://user:***@host:5432/db
// ─────────────────────────────────────────
function maskSecret(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    // If URL parsing fails, just mask the whole thing
    return '***';
  }
}