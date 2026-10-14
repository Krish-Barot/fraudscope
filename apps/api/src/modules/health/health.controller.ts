// apps/api/src/modules/health/health.controller.ts
// Detailed health check endpoint
// Polls each service individually and returns structured status
// Used by the system health dashboard page

import { Request, Response, NextFunction } from 'express';
import { db } from '../../config/database';
import { redisClient } from '../../config/redis';

// Track server start time for uptime calculation
const SERVER_START = Date.now();

// Track transactions processed (incremented by worker — stubbed here)
// In production this would come from a Redis counter the worker increments
let txProcessedThisMinute = 0;
let txProcessedLastMinute = 0;
let minuteWindowStart = Date.now();

export function incrementTxCounter() {
    const now = Date.now();
    // Roll the window every 60 seconds
    if (now - minuteWindowStart >= 60000) {
        txProcessedLastMinute = txProcessedThisMinute;
        txProcessedThisMinute = 0;
        minuteWindowStart = now;
    }
    txProcessedThisMinute++;
}

export async function getDetailedHealth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const checks = await Promise.allSettled([
            checkDatabase(),
            checkRedis(),
            checkWorker(),
        ]);

        const [dbResult, redisResult, workerResult] = checks;

        const services = {
            api: {
                name: 'API Server',
                status: 'healthy' as 'healthy' | 'unhealthy',
                latency_ms: 0,
                message: 'Running',
                checked_at: new Date().toISOString(),
            },
            postgres: dbResult.status === 'fulfilled'
                ? dbResult.value
                : { name: 'PostgreSQL', status: 'unhealthy' as const, latency_ms: -1, message: (dbResult as PromiseRejectedResult).reason?.message || 'Connection failed', checked_at: new Date().toISOString() },
            redis: redisResult.status === 'fulfilled'
                ? redisResult.value
                : { name: 'Redis', status: 'unhealthy' as const, latency_ms: -1, message: (redisResult as PromiseRejectedResult).reason?.message || 'Connection failed', checked_at: new Date().toISOString() },
            worker: workerResult.status === 'fulfilled'
                ? workerResult.value
                : { name: 'Engine Worker', status: 'unhealthy' as const, latency_ms: -1, message: (workerResult as PromiseRejectedResult).reason?.message || 'Check failed', checked_at: new Date().toISOString() },
        };

        const allHealthy = Object.values(services).every(s => s.status === 'healthy');
        const uptimeSeconds = Math.floor((Date.now() - SERVER_START) / 1000);

        // Stream queue depth — wrapped so a dead Redis can't crash the handler
        let queueDepth = 0;
        try {
            const len = await Promise.race([
                redisClient.xlen('tx:incoming'),
                new Promise<number>((_, reject) =>
                    setTimeout(() => reject(new Error('Queue depth timeout')), 3000)
                ),
            ]);
            queueDepth = len;
        } catch { /* Redis might be down — default to 0 */ }

        res.status(allHealthy ? 200 : 503).json({
            status: allHealthy ? 'healthy' : 'degraded',
            uptime_seconds: uptimeSeconds,
            uptime_human: formatUptime(uptimeSeconds),
            timestamp: new Date().toISOString(),
            services,
            metrics: {
                queue_depth: queueDepth,
                tx_per_minute: txProcessedLastMinute,
            },
        });
    } catch (err) {
        // Last resort — even if the health check logic itself crashes, return valid JSON
        const uptimeSeconds = Math.floor((Date.now() - SERVER_START) / 1000);
        res.status(503).json({
            status: 'degraded',
            uptime_seconds: uptimeSeconds,
            uptime_human: formatUptime(uptimeSeconds),
            timestamp: new Date().toISOString(),
            services: {
                api:      { name: 'API Server',    status: 'unhealthy', latency_ms: -1, message: 'Health check error: ' + (err as Error).message, checked_at: new Date().toISOString() },
                postgres: { name: 'PostgreSQL',    status: 'unhealthy', latency_ms: -1, message: 'Unknown', checked_at: new Date().toISOString() },
                redis:    { name: 'Redis',         status: 'unhealthy', latency_ms: -1, message: 'Unknown', checked_at: new Date().toISOString() },
                worker:   { name: 'Engine Worker', status: 'unhealthy', latency_ms: -1, message: 'Unknown', checked_at: new Date().toISOString() },
            },
            metrics: { queue_depth: 0, tx_per_minute: 0 },
        });
    }
}

async function checkDatabase() {
    const start = Date.now();
    try {
        // Race against a 3s timeout so a hung connection doesn't block forever
        await Promise.race([
            db.raw('SELECT 1'),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Database ping timeout after 3s')), 3000)
            ),
        ]);
        const latency = Date.now() - start;

        // Get some basic DB stats (also with timeout)
        let count = 0;
        try {
            const [row] = await Promise.race([
                db('transactions').count('id as count'),
                new Promise<any>((_, reject) =>
                    setTimeout(() => reject(new Error('Count query timeout')), 3000)
                ),
            ]);
            count = Number(row.count);
        } catch { /* count query failed — still healthy if ping passed */ }

        return {
            name: 'PostgreSQL',
            status: 'healthy' as const,
            latency_ms: latency,
            message: `Connected — ${count.toLocaleString()} transactions`,
            checked_at: new Date().toISOString(),
        };
    } catch (err) {
        return {
            name: 'PostgreSQL',
            status: 'unhealthy' as const,
            latency_ms: Date.now() - start,
            message: (err as Error).message,
            checked_at: new Date().toISOString(),
        };
    }
}

async function checkRedis() {
    const start = Date.now();
    try {
        // Race against a 3s timeout so a hung Redis doesn't block forever
        await Promise.race([
            redisClient.ping(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Redis ping timeout after 3s')), 3000)
            ),
        ]);
        const latency = Date.now() - start;

        let version = 'unknown';
        try {
            const info = await Promise.race([
                redisClient.info('server'),
                new Promise<string>((_, reject) =>
                    setTimeout(() => reject(new Error('Redis info timeout')), 3000)
                ),
            ]);
            const versionMatch = info.match(/redis_version:([^\r\n]+)/);
            version = versionMatch ? versionMatch[1].trim() : 'unknown';
        } catch { /* info failed — still healthy if ping passed */ }

        return {
            name: 'Redis',
            status: 'healthy' as const,
            latency_ms: latency,
            message: `Connected — v${version}`,
            checked_at: new Date().toISOString(),
        };
    } catch (err) {
        return {
            name: 'Redis',
            status: 'unhealthy' as const,
            latency_ms: Date.now() - start,
            message: (err as Error).message,
            checked_at: new Date().toISOString(),
        };
    }
}

async function checkWorker() {
    // Check worker by looking for recent activity in the consumer group
    // If the worker is alive, it should have processed messages recently
    try {
        const groups = await redisClient.xinfo('GROUPS', 'tx:incoming') as any[];
        const engineGroup = groups.find((g: any) => {
            // xinfo GROUPS returns flat array: [key, value, key, value, ...]
            const obj: Record<string, any> = {};
            for (let i = 0; i < g.length; i += 2) {
                obj[g[i]] = g[i + 1];
            }
            return obj.name === 'engine-workers';
        });

        if (!engineGroup) {
            return {
                name: 'Engine Worker',
                status: 'unhealthy' as const,
                latency_ms: 0,
                message: 'Consumer group not found — worker may not have started',
                checked_at: new Date().toISOString(),
            };
        }

        // Parse the flat array into an object
        const groupObj: Record<string, any> = {};
        for (let i = 0; i < engineGroup.length; i += 2) {
            groupObj[engineGroup[i]] = engineGroup[i + 1];
        }

        const pending = parseInt(groupObj['pending'] || '0', 10);
        const consumers = parseInt(groupObj['consumers'] || '0', 10);

        return {
            name: 'Engine Worker',
            status: 'healthy' as const,
            latency_ms: 0,
            message: `${consumers} consumer${consumers !== 1 ? 's' : ''} — ${pending} pending`,
            checked_at: new Date().toISOString(),
        };
    } catch (err) {
        // Stream might not exist yet (no transactions sent)
        const msg = (err as Error).message;
        if (msg.includes('ERR no such key') || msg.includes('no such key')) {
            return {
                name: 'Engine Worker',
                status: 'healthy' as const,
                latency_ms: 0,
                message: 'Stream not yet created — no transactions processed',
                checked_at: new Date().toISOString(),
            };
        }
        return {
            name: 'Engine Worker',
            status: 'unhealthy' as const,
            latency_ms: 0,
            message: msg,
            checked_at: new Date().toISOString(),
        };
    }
}

function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${secs}s`);

    return parts.join(' ');
}