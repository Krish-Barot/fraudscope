import { z } from 'zod';
declare const apiSchema: z.ZodObject<{
    DATABASE_URL: z.ZodString;
    REDIS_URL: z.ZodString;
    NODE_ENV: z.ZodDefault<z.ZodEnum<["development", "test", "production"]>>;
    LOG_LEVEL: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>;
    ENGINE_POLL_INTERVAL: z.ZodDefault<z.ZodNumber>;
    ANALYTICS_CACHE_TTL: z.ZodDefault<z.ZodNumber>;
    SIM_ENABLED: z.ZodDefault<z.ZodEffects<z.ZodString, boolean, string>>;
    TEST_DATABASE_URL: z.ZodOptional<z.ZodString>;
} & {
    JWT_ACCESS_SECRET: z.ZodString;
    JWT_REFRESH_SECRET: z.ZodString;
    API_KEY: z.ZodString;
    PORT: z.ZodNumber;
    CORS_ORIGIN: z.ZodString;
    JWT_ACCESS_EXPIRY: z.ZodDefault<z.ZodString>;
    JWT_REFRESH_EXPIRY: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    DATABASE_URL: string;
    REDIS_URL: string;
    NODE_ENV: "development" | "test" | "production";
    LOG_LEVEL: "debug" | "info" | "warn" | "error";
    ENGINE_POLL_INTERVAL: number;
    ANALYTICS_CACHE_TTL: number;
    SIM_ENABLED: boolean;
    JWT_ACCESS_SECRET: string;
    JWT_REFRESH_SECRET: string;
    API_KEY: string;
    PORT: number;
    CORS_ORIGIN: string;
    JWT_ACCESS_EXPIRY: string;
    JWT_REFRESH_EXPIRY: string;
    TEST_DATABASE_URL?: string | undefined;
}, {
    DATABASE_URL: string;
    REDIS_URL: string;
    JWT_ACCESS_SECRET: string;
    JWT_REFRESH_SECRET: string;
    API_KEY: string;
    PORT: number;
    CORS_ORIGIN: string;
    NODE_ENV?: "development" | "test" | "production" | undefined;
    LOG_LEVEL?: "debug" | "info" | "warn" | "error" | undefined;
    ENGINE_POLL_INTERVAL?: number | undefined;
    ANALYTICS_CACHE_TTL?: number | undefined;
    SIM_ENABLED?: string | undefined;
    TEST_DATABASE_URL?: string | undefined;
    JWT_ACCESS_EXPIRY?: string | undefined;
    JWT_REFRESH_EXPIRY?: string | undefined;
}>;
declare const workerSchema: z.ZodObject<{
    DATABASE_URL: z.ZodString;
    REDIS_URL: z.ZodString;
    NODE_ENV: z.ZodDefault<z.ZodEnum<["development", "test", "production"]>>;
    LOG_LEVEL: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>;
    ENGINE_POLL_INTERVAL: z.ZodDefault<z.ZodNumber>;
    ANALYTICS_CACHE_TTL: z.ZodDefault<z.ZodNumber>;
    SIM_ENABLED: z.ZodDefault<z.ZodEffects<z.ZodString, boolean, string>>;
    TEST_DATABASE_URL: z.ZodOptional<z.ZodString>;
} & {
    ENGINE_BATCH_SIZE: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    DATABASE_URL: string;
    REDIS_URL: string;
    NODE_ENV: "development" | "test" | "production";
    LOG_LEVEL: "debug" | "info" | "warn" | "error";
    ENGINE_POLL_INTERVAL: number;
    ANALYTICS_CACHE_TTL: number;
    SIM_ENABLED: boolean;
    ENGINE_BATCH_SIZE: number;
    TEST_DATABASE_URL?: string | undefined;
}, {
    DATABASE_URL: string;
    REDIS_URL: string;
    NODE_ENV?: "development" | "test" | "production" | undefined;
    LOG_LEVEL?: "debug" | "info" | "warn" | "error" | undefined;
    ENGINE_POLL_INTERVAL?: number | undefined;
    ANALYTICS_CACHE_TTL?: number | undefined;
    SIM_ENABLED?: string | undefined;
    TEST_DATABASE_URL?: string | undefined;
    ENGINE_BATCH_SIZE?: number | undefined;
}>;
export type ApiEnv = z.infer<typeof apiSchema>;
export type WorkerEnv = z.infer<typeof workerSchema>;
export type Env = ApiEnv | WorkerEnv;
export declare function validateApiEnv(): ApiEnv;
export declare function validateWorkerEnv(): WorkerEnv;
export declare function getEnv(): Env;
export {};
//# sourceMappingURL=env.d.ts.map